from __future__ import annotations

import sys


def utf8_stdout(stream=None):
    s = sys.stdout if stream is None else stream
    try:
        s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError, OSError):
        pass
    return s


def entry_is_ektos() -> bool:
    spec = getattr(sys.modules.get("__main__"), "__spec__", None)
    return bool(spec is not None and str(getattr(spec, "name", "") or "").startswith("ektos."))
