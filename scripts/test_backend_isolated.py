"""Run backend pytest without local dotenv files, network, or company databases.

This wrapper changes only the test process; it is not a production sandbox.
Run using backend/.venv/Scripts/python.exe from the project root.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import os
import socket
import sys


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    os.chdir(root)
    sys.path.insert(0, str(root))
    # Remove names without reading or printing credential values.
    for key in list(os.environ):
        if key.startswith(("MYSQL_", "AGENT_", "VISION_", "DASHSCOPE_")):
            os.environ.pop(key, None)
    os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import dotenv
    import dotenv.main
    import sqlalchemy
    from sqlalchemy.engine import make_url
    import pytest

    args = sys.argv[1:] or [
        "backend/tests/test_agent.py", "backend/tests/test_agent_numbering.py",
        "backend/tests/test_agent_evidence.py", "backend/tests/test_agent_feedback.py", "-q"
    ]
    if any(arg.startswith(("--basetemp", "--override-ini")) or arg == "-o" for arg in args):
        raise SystemExit("Do not override the isolated test directories.")

    with TemporaryDirectory(prefix="vision-lab-unit-") as folder:
        temp = Path(folder).resolve()
        os.environ["VISION_DATA_DIR"] = str(temp / "data")
        original_create_engine = sqlalchemy.create_engine
        original_connect = socket.socket.connect

        def isolated_engine(url, *engine_args, **kwargs):
            parsed = make_url(url)
            if parsed.get_backend_name() != "sqlite":
                raise RuntimeError("Isolated tests allow only temporary SQLite.")
            if parsed.database not in (None, "", ":memory:"):
                database = Path(parsed.database).resolve()
                if not database.is_relative_to(temp):
                    raise RuntimeError("SQLite must be inside the test temporary directory.")
            return original_create_engine(url, *engine_args, **kwargs)

        def no_network(*args, **kwargs):
            raise RuntimeError("Network connections are disabled in isolated backend tests.")

        def guarded_connect(sock, address):
            # Windows asyncio implements its internal socketpair over loopback.
            # Allow only that stdlib caller, not arbitrary localhost services.
            pair_code = getattr(socket.socketpair, "__code__", None)
            if pair_code is not None and sys._getframe(1).f_code is pair_code:
                return original_connect(sock, address)
            return no_network()

        # Patch before importing the application: it loads configuration at import time.
        with (
            patch.object(dotenv, "load_dotenv", return_value=False),
            patch.object(dotenv, "dotenv_values", return_value={}),
            patch.object(dotenv.main, "load_dotenv", return_value=False),
            patch.object(dotenv.main, "dotenv_values", return_value={}),
            patch.object(sqlalchemy, "create_engine", side_effect=isolated_engine),
            patch.object(socket.socket, "connect", new=guarded_connect),
            patch.object(socket.socket, "connect_ex", side_effect=no_network),
        ):
            print("Isolated tests: dotenv disabled; temporary SQLite only; network disabled.")
            return int(pytest.main([
                *args, "--basetemp", str(temp / "pytest"),
                "-o", f"cache_dir={temp / 'cache'}",
            ]))


if __name__ == "__main__":
    raise SystemExit(main())
