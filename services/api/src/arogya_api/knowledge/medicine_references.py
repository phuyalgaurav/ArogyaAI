"""Bounded public label references; never an identification of the patient's medicine."""

import asyncio
import re
import xml.etree.ElementTree as ET
from typing import Literal
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter
from pydantic import Field

from arogya_api.core.contracts import Contract

BASE = "https://dailymed.nlm.nih.gov/dailymed"
NS = {"s": "urn:hl7-org:v3"}
ALIASES = {"paracetamol": "acetaminophen"}


class ReferenceRequest(Contract):
    names: list[str] = Field(min_length=1, max_length=12)


class MedicineReference(Contract):
    name: str
    status: Literal["found", "not_found", "unavailable"]
    title: str = ""
    description: str = ""
    image_url: str | None = None
    image_description: str = ""
    source_url: str | None = None


def label_reference(name, title, setid, xml):
    root = ET.fromstring(xml)
    # Select images from the package label section, avoiding study charts/chemical diagrams.
    image_id = None
    for section in root.findall(".//s:section", NS):
        code = section.find("s:code", NS)
        if code is not None and code.get("code") == "51945-4":
            media = section.find(".//s:renderMultiMedia", NS)
            if media is not None:
                image_id = media.get("referencedObject")
                break
    image_url = None
    caption = ""
    for media in root.findall(".//s:observationMedia", NS):
        if image_id and media.get("ID") == image_id:
            ref = media.find("s:value/s:reference", NS)
            if ref is not None and ref.get("value"):
                image_url = (
                    BASE + "/image.cfm?" + urlencode({"setid": setid, "name": ref.get("value")})
                )
                caption = " ".join(media.findtext("s:text", default="", namespaces=NS).split())
    description = f"Published product label: {title}."
    # The label's own description, rather than inferred medical advice or visual attributes.
    for section in root.findall(".//s:section", NS):
        code = section.find("s:code", NS)
        if code is not None and code.get("code") == "34089-3":
            paragraph = section.find("s:text/s:paragraph", NS)
            if paragraph is not None:
                description = (
                    " ".join(" ".join(paragraph.itertext()).split())
                    .split("Chemically,")[0][:700]
                    .strip()
                )
                break
    return MedicineReference(
        name=name,
        status="found",
        title=title,
        description=description,
        image_url=image_url,
        image_description=(
            caption
            if len(caption) > 12 and re.search(r"[A-Za-z]{3}", caption)
            else f"Package label for {title}"
        )
        if image_url
        else "",
        source_url=BASE + "/drugInfo.cfm?" + urlencode({"setid": setid}),
    )


async def lookup(client, name):
    query = ALIASES.get(name.casefold(), name)
    try:
        response = await client.get(
            BASE + "/services/v2/spls.json",
            params={"drug_name": query, "pagesize": 30},
        )
        response.raise_for_status()
        rows = response.json().get("data", [])
        attempts = 0
        for row in rows[:30]:
            title, setid = row.get("title", ""), row.get("setid", "")
            if not re.fullmatch(r"[a-fA-F0-9-]{36}", setid):
                continue
            # A name anywhere in a combination label is not an exact product match.
            if not re.match(re.escape(query) + r"(?!\w)", title, re.I):
                continue
            if attempts >= 3:
                break
            attempts += 1
            label = await client.get(BASE + f"/services/v2/spls/{setid}.xml")
            label.raise_for_status()
            if len(label.content) > 2_000_000:
                continue
            root = ET.fromstring(label.content)
            ingredients = {
                item.findtext("s:ingredientSubstance/s:name", default="", namespaces=NS).casefold()
                for item in root.findall(".//s:ingredient", NS)
                if item.get("classCode", "").startswith("ACT")
            }
            if query.casefold() in ingredients and len(ingredients) != 1:
                continue
            result = label_reference(name, title, setid, label.content)
            if result.image_url:
                return result
            # Keep the description even when the source has no package image.
            return result
        return MedicineReference(name=name, status="not_found")
    except (httpx.HTTPError, ValueError, KeyError, TypeError, ET.ParseError):
        return MedicineReference(name=name, status="unavailable")


def medicine_reference_router():
    router = APIRouter(prefix="/api/v1/medicines", tags=["Public medicine references"])

    @router.post("/references", response_model=list[MedicineReference])
    async def references(payload: ReferenceRequest):
        names = list(dict.fromkeys(n.strip() for n in payload.names))
        if any(not re.fullmatch(r"[\w\s()+/-]{2,100}", n) for n in names):
            from fastapi import HTTPException

            raise HTTPException(422, "invalid_medicine_name")
        async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
            semaphore = asyncio.Semaphore(3)

            async def bounded(name):
                async with semaphore:
                    return await lookup(client, name)

            return await asyncio.gather(*(bounded(n) for n in names))

    return router
