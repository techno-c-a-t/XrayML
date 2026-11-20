import http.server
import os
import socket
import socketserver
import ssl
import subprocess
import threading

HTTP_PORT = 8080
HTTPS_PORT = 8443
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_PUBLIC = os.path.join(BASE_DIR, "web/public")
DIRECTORY = WEB_PUBLIC if os.path.exists(WEB_PUBLIC) else BASE_DIR
CERT_DIR = os.path.join(BASE_DIR, ".cert")
CERT_FILE = os.path.join(CERT_DIR, "cert.pem")
KEY_FILE = os.path.join(CERT_DIR, "key.pem")


class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


class ThreadingHTTPSServer(ThreadingTCPServer):
    def __init__(self, server_address, RequestHandlerClass, ssl_ctx, fallback_host):
        self.ssl_ctx = ssl_ctx
        self.fallback_host = fallback_host
        super().__init__(server_address, RequestHandlerClass)

    def process_request_thread(self, request, client_address):
        try:
            first_byte = request.recv(1, socket.MSG_PEEK)
            if not first_byte:
                self.shutdown_request(request)
                return
            # TLS ClientHello начинается с 0x16; если пришёл обычный HTTP — редиректим на HTTPS
            if first_byte != b"\x16":
                data = request.recv(2048).decode("latin1", errors="ignore")
                host = self.fallback_host
                path = "/"
                lines = data.split("\r\n")
                if lines:
                    parts = lines[0].split(" ")
                    if len(parts) >= 2 and parts[1].startswith("/"):
                        path = parts[1]
                for line in lines[1:]:
                    if line.lower().startswith("host:"):
                        host = line.split(":", 1)[1].strip()
                        break
                resp = (
                    f"HTTP/1.1 302 Found\r\n"
                    f"Location: https://{host}{path}\r\n"
                    f"Connection: close\r\n\r\n"
                ).encode("ascii")
                request.sendall(resp)
                self.shutdown_request(request)
                return

            ssl_sock = self.ssl_ctx.wrap_socket(request, server_side=True)
        except (ssl.SSLError, OSError):
            self.shutdown_request(request)
            return

        super().process_request_thread(ssl_sock, client_address)


class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Включаем Cross-Origin Isolation для поддержки SharedArrayBuffer и многопоточности WebAssembly
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()


def get_lan_ips():
    """Возвращает список локальных IPv4-адресов машины."""
    ips = []
    try:
        out = subprocess.check_output(["hostname", "-I"], text=True).strip()
        for token in out.split():
            if ":" not in token and not token.startswith("127."):
                ips.append(token)
    except (OSError, subprocess.SubprocessError):
        pass
    if not ips:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                ips.append(s.getsockname()[0])
        except OSError:
            ips.append("127.0.0.1")
    return ips


def ensure_self_signed_cert(lan_ips):
    """Генерирует локальный самоподписанный SSL-сертификат с SAN для всех локальных IP и localhost."""
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        return
    os.makedirs(CERT_DIR, exist_ok=True)
    san_entries = ["DNS:localhost", "IP:127.0.0.1"] + [f"IP:{ip}" for ip in lan_ips]
    san = ",".join(dict.fromkeys(san_entries))
    primary_ip = lan_ips[0]
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", KEY_FILE, "-out", CERT_FILE, "-days", "365",
            "-subj", f"/CN={primary_ip}",
            "-addext", f"subjectAltName={san}",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


if __name__ == "__main__":
    lan_ips = get_lan_ips()
    ensure_self_signed_cert(lan_ips)

    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_ctx.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)

    http_server = ThreadingTCPServer(("", HTTP_PORT), CustomHandler)
    https_server = ThreadingHTTPSServer(
        ("", HTTPS_PORT), CustomHandler, ssl_ctx, f"{lan_ips[0]}:{HTTPS_PORT}"
    )

    threading.Thread(target=http_server.serve_forever, daemon=True).start()
    print(f"HTTP:  http://{lan_ips[0]}:{HTTP_PORT}  (и http://localhost:{HTTP_PORT})")
    print(f"HTTPS: https://{lan_ips[0]}:{HTTPS_PORT} (WebGPU + SharedArrayBuffer / Workers)")
    https_server.serve_forever()
