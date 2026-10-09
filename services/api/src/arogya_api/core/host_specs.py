"""Coarse local host capacity, without hostnames, user names, or filesystem paths."""

import os
import platform
import subprocess
from functools import lru_cache

from arogya_api.runtime.models import HostSpecs


@lru_cache(maxsize=1)
def host_specs():
    memory = None
    try:
        if platform.system() == "Darwin":
            memory = int(
                subprocess.check_output(
                    ["/usr/sbin/sysctl", "-n", "hw.memsize"], timeout=2, stderr=subprocess.DEVNULL
                )
            )
        elif hasattr(os, "sysconf"):
            pages = os.sysconf("SC_PHYS_PAGES")
            page_size = os.sysconf("SC_PAGE_SIZE")
            memory = pages * page_size if pages > 0 and page_size > 0 else None
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return HostSpecs(
        system=platform.system()[:40],
        architecture=platform.machine()[:40],
        cpu_threads=os.process_cpu_count(),
        memory_bytes=memory,
    )
