#!/usr/bin/env python3
"""Compila o instalador Windows do Stapp."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
NODE_MODULES = WEB_DIR / "node_modules"
INSTALLER_DIR = WEB_DIR / "src-tauri" / "target" / "release" / "bundle" / "nsis"


def command_path(name: str) -> str:
    candidates = [f"{name}.cmd", name] if sys.platform == "win32" else [name]
    for candidate in candidates:
        found = shutil.which(candidate)
        if found:
            return found
    raise RuntimeError(
        f"'{name}' nao foi encontrado no PATH. Instale o Node.js e o pnpm antes de continuar."
    )


def run(command: list[str]) -> None:
    print(f"\n> {' '.join(command)}", flush=True)
    subprocess.run(command, cwd=WEB_DIR, check=True)


def newest_installer() -> Path:
    installers = list(INSTALLER_DIR.glob("*-setup.exe"))
    if not installers:
        raise RuntimeError(f"A build terminou, mas nenhum instalador apareceu em {INSTALLER_DIR}")
    return max(installers, key=lambda path: path.stat().st_mtime)


def main() -> int:
    parser = argparse.ArgumentParser(description="Compila o instalador .exe do Stapp.")
    parser.add_argument(
        "--install",
        action="store_true",
        help="reinstala as dependencias do frontend antes da build",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="executa todos os testes antes de gerar o instalador",
    )
    args = parser.parse_args()

    if not WEB_DIR.is_dir():
        raise RuntimeError(f"Diretorio do frontend nao encontrado: {WEB_DIR}")

    pnpm = command_path("pnpm")
    if args.install or not NODE_MODULES.is_dir():
        run([pnpm, "install", "--frozen-lockfile"])
    if args.check:
        run([pnpm, "test"])

    run([pnpm, "app:build"])
    installer = newest_installer()
    size_mb = installer.stat().st_size / (1024 * 1024)

    print("\nBuild concluida.")
    print(f"Instalador: {installer}")
    print(f"Tamanho: {size_mb:.1f} MB")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nBuild cancelada.", file=sys.stderr)
        raise SystemExit(130)
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"\nErro: {error}", file=sys.stderr)
        raise SystemExit(1)
