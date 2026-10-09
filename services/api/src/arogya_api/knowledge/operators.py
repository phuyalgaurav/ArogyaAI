import hashlib
import hmac
import json
from datetime import UTC, datetime

from fastapi import HTTPException

from arogya_api.knowledge.review_models import Operator


class OperatorRegistry:
    def __init__(self, path):
        self.path = path

    def authenticate(self, token):
        if not self.path:
            raise HTTPException(503, "operator_access_not_configured")
        if not token or len(token) > 512:
            raise HTTPException(401, "invalid_operator_token")
        try:
            if self.path.stat().st_size > 100000:
                raise ValueError
            data = json.loads(self.path.read_text())
            if not isinstance(data, list) or len(data) > 100:
                raise ValueError
            operators = [Operator.model_validate(item) for item in data]
            if len({o.id for o in operators}) != len(operators):
                raise ValueError
            if len({o.token_sha256 for o in operators}) != len(operators):
                raise ValueError
        except (OSError, ValueError, TypeError):
            raise HTTPException(503, "operator_registry_invalid") from None
        digest = hashlib.sha256(token.encode()).hexdigest()
        for operator in operators:
            if (
                hmac.compare_digest(digest, operator.token_sha256)
                and operator.enabled
                and operator.expires_at > datetime.now(UTC)
            ):
                return operator
        raise HTTPException(401, "invalid_operator_token")


def require_role(operator, *roles):
    if not operator.enabled or operator.expires_at <= datetime.now(UTC):
        raise HTTPException(401, "operator_access_expired")
    if not set(operator.roles).intersection(roles):
        raise HTTPException(403, "operator_role_required")
