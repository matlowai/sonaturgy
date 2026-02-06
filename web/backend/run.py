#!/usr/bin/env python3
"""Uvicorn entrypoint for the ACE-Step web backend."""

import sys
import os

# Ensure project root is importable
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import uvicorn
from web.backend import config


def main():
    uvicorn.run(
        "web.backend.app:create_app",
        factory=True,
        host=config.HOST,
        port=config.PORT,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
