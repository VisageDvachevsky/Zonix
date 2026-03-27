#!/bin/sh
set -eu

python -m app.migrations
python -m app.bootstrap

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
