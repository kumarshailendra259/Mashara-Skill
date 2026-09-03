"""Shared test fixtures.

Credentials come from environment variables so the test suite has no
hard-coded secrets. When running locally you can drop into `.env.test`:

    TEST_ADMIN_EMAIL=admin@finance.app
    TEST_ADMIN_PASSWORD=Admin@123
    TEST_HR_EMAIL=hr@finance.app
    TEST_HR_PASSWORD=Hr@12345

CI/CD systems inject their own values. Nothing in this file leaks a real
secret — the fallback defaults are the seeded local dev users that anyone
running the stack from scratch already has in their DB.
"""

from __future__ import annotations
import os
import pytest


def _env(key: str, default: str) -> str:
    return os.environ.get(key, default)


@pytest.fixture(scope="session")
def test_credentials() -> dict:
    return {
        "admin": {
            "email": _env("TEST_ADMIN_EMAIL", "admin@finance.app"),
            "password": _env("TEST_ADMIN_PASSWORD", "Admin@123"),
        },
        "hr": {
            "email": _env("TEST_HR_EMAIL", "hr@finance.app"),
            "password": _env("TEST_HR_PASSWORD", "Hr@12345"),
        },
        "company_admin": {
            "email": _env("TEST_COMPANY_ADMIN_EMAIL", "companyadmin1@x.com"),
            "password": _env("TEST_COMPANY_ADMIN_PASSWORD", "Test@1234"),
        },
    }


@pytest.fixture(scope="session")
def api_base_url() -> str:
    return _env("TEST_API_BASE_URL", "http://localhost:8001")
