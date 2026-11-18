import http.server
import socketserver
import os

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_PUBLIC = os.path.join(BASE_DIR, "web/public")
DIRECTORY = WEB_PUBLIC if os.path.exists(WEB_PUBLIC) else BASE_DIR

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Включаем Cross-Origin Isolation для поддержки SharedArrayBuffer и многопоточности WebAssembly
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        print(f"Serving HTTP on port {PORT} with Cross-Origin-Isolation (SharedArrayBuffer enabled)...")
        httpd.serve_forever()
