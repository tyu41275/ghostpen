"""Shared fixtures and path setup for scripts tests."""
from __future__ import annotations

import sys
import types
from pathlib import Path

# Provide a stub 'requests' module so post_content can import without it installed
if "requests" not in sys.modules:
    requests_stub = types.ModuleType("requests")
    requests_stub.ConnectionError = ConnectionError
    requests_stub.HTTPError = Exception
    requests_stub.Timeout = TimeoutError
    requests_stub.post = None
    sys.modules["requests"] = requests_stub

# Add scripts/ to the path so test files can import post_content / post_templates
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
