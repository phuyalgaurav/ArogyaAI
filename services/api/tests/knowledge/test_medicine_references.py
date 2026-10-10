import asyncio

import httpx

from arogya_api.knowledge.medicine_references import label_reference, lookup

XML = b"""<document xmlns="urn:hl7-org:v3"><section><code code="51945-4"/>
<text><renderMultiMedia referencedObject="package"/></text></section>
<observationMedia ID="graph"><text>Study graph</text>
<value><reference value="graph.jpg"/></value></observationMedia>
<observationMedia ID="package"><text>Amoxicillin capsule carton</text>
<value><reference value="carton.jpg"/></value></observationMedia>
<section><code code="34089-3"/><text>
<paragraph>Amoxicillin capsules contain amoxicillin.</paragraph>
</text></section></document>"""


def test_label_uses_package_image_and_source_description():
    result = label_reference("Amoxicillin", "AMOXICILLIN CAPSULE", "demo", XML)
    assert "carton.jpg" in result.image_url
    assert "graph.jpg" not in result.image_url
    assert result.image_description == "Amoxicillin capsule carton"
    assert result.description == "Amoxicillin capsules contain amoxicillin."


def test_no_package_image_does_not_substitute_graph():
    result = label_reference(
        "Amoxicillin",
        "AMOXICILLIN CAPSULE",
        "demo",
        XML.replace(b'code="51945-4"', b'code="other"'),
    )
    assert result.image_url is None


def test_lookup_rejects_substring_and_handles_outage():
    def handler(request):
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "title": "NOTAMOXICILLIN TABLET",
                        "setid": "1d978882-d938-40cf-96be-59052d9599fe",
                    }
                ]
            },
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            assert (await lookup(client, "amoxicillin")).status == "not_found"
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: httpx.Response(503))
        ) as client:
            assert (await lookup(client, "amoxicillin")).status == "unavailable"

    asyncio.run(run())


def test_generic_name_never_returns_combination_product():
    combination = XML.replace(
        b"</document>",
        b'<ingredient classCode="ACTIM"><ingredientSubstance>'
        b"<name>ACETAMINOPHEN</name></ingredientSubstance></ingredient>"
        b'<ingredient classCode="ACTIM"><ingredientSubstance>'
        b"<name>CAFFEINE</name></ingredientSubstance></ingredient></document>",
    )

    def handler(request):
        if request.url.path.endswith(".json"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "title": "ACETAMINOPHEN AND CAFFEINE TABLET",
                            "setid": "1d978882-d938-40cf-96be-59052d9599fe",
                        }
                    ]
                },
            )
        return httpx.Response(200, content=combination)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            assert (await lookup(client, "Paracetamol")).status == "not_found"

    asyncio.run(run())
