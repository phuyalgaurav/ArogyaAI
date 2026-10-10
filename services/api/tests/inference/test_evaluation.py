import json
from pathlib import Path

from arogya_api.cli.evaluate import percentile, run_evaluation, summary
from arogya_api.core.settings import Settings


def test_deterministic_suite_exercises_gateway_without_claiming_model_quality(tmp_path):
    corpus = json.loads(
        (Path(__file__).resolve().parents[1] / "fixtures/backend_cases.json").read_text(
            encoding="utf-8"
        )
    )
    report = run_evaluation(corpus, Settings(database_path=tmp_path / "unused.db"), "deterministic")
    assert report["metrics"]["gateway"]["passed"] == 24
    assert report["metrics"]["gateway"]["all_passed"] is True
    assert report["model_exercised"] is False
    assert report["metrics"]["selection"]["executed"] is False
    assert report["metrics"]["selection"]["all_passed"] is None
    assert report["clinical_validation"] is False
    assert report["release"]["free_form_answering"] == "blocked"
    assert "message" not in json.dumps(report)


def test_empty_diagnostics_are_not_reported_as_a_pass():
    assert summary([])["all_passed"] is None
    assert percentile([], 0.95) is None
