"""Entry point production (gunicorn)."""
import os

from server import app, init_app

init_app()
port = int(os.environ.get("PORT", 8080))

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=port)
