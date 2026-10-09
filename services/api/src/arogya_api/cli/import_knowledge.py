import argparse
import json
from pathlib import Path

from dotenv import load_dotenv
from fastapi import HTTPException

from arogya_api.core.paths import workspace_root
from arogya_api.core.settings import Settings
from arogya_api.knowledge.governance import Governance
from arogya_api.knowledge.operators import OperatorRegistry
from arogya_api.knowledge.review_models import MedicineImport, SourceDraft
from arogya_api.knowledge.store import Store


def main():
    parser = argparse.ArgumentParser(
        description="Import operator-reviewed public knowledge, never patient records."
    )
    parser.add_argument("kind", choices=["source", "medicine"])
    parser.add_argument("path", type=Path)
    root = workspace_root()
    parser.add_argument("--token-file", type=Path, default=root / ".local/operator-token")
    args = parser.parse_args()
    if args.path.stat().st_size > 100000:
        parser.error("Import file must be smaller than 100 KB")
    load_dotenv(root / ".local/backend.env", override=False)
    settings = Settings.from_environment()
    store = Store(settings.database_path, settings.allow_test_knowledge)
    governance = Governance(
        store, (settings.knowledge_audit_key or settings.signing_key).get_secret_value()
    )
    try:
        if args.token_file.stat().st_size > 1024:
            raise ValueError
        actor = OperatorRegistry(settings.operator_registry_path).authenticate(
            args.token_file.read_text().strip()
        )
        data = json.loads(args.path.read_text())
        if args.kind == "source":
            governance.submit(SourceDraft.model_validate(data), actor)
        else:
            governance.import_medicine(MedicineImport.model_validate(data), actor)
    except (ValueError, OSError):
        parser.error("Invalid import or credential file; use the current public-source schemas.")
    except HTTPException as error:
        parser.error(str(error.detail))
    print(
        "Source draft submitted for independent reviews."
        if args.kind == "source"
        else "Clinically reviewed catalog record imported; identity matches remain candidates."
    )


if __name__ == "__main__":
    main()
