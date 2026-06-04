#!/usr/bin/env python3
import base64
import select
import socket
import socketserver


LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 18080
UPSTREAM_HOST = "172.245.156.243"
UPSTREAM_PORT = 31080
UPSTREAM_USER = "vpsproxy"
UPSTREAM_PASS = "7nokQh7IHqPrTkOBOl7QRXw9"


def auth_header() -> bytes:
    raw = f"{UPSTREAM_USER}:{UPSTREAM_PASS}".encode("utf-8")
    return b"Proxy-Authorization: Basic " + base64.b64encode(raw) + b"\r\n"


def recv_headers(sock: socket.socket) -> bytes:
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(65536)
        if not chunk:
            break
        data += chunk
        if len(data) > 1024 * 1024:
            raise OSError("headers too large")
    return data


def strip_proxy_headers(headers: bytes) -> bytes:
    kept = []
    for line in headers.split(b"\r\n"):
        lower = line.lower()
        if lower.startswith(b"proxy-authorization:"):
            continue
        if lower.startswith(b"proxy-connection:"):
            continue
        kept.append(line)
    return b"\r\n".join(kept)


def pipe(a: socket.socket, b: socket.socket) -> None:
    sockets = [a, b]
    while True:
        readable, _, _ = select.select(sockets, [], [], 300)
        if not readable:
            return
        for sock in readable:
            other = b if sock is a else a
            data = sock.recv(65536)
            if not data:
                return
            other.sendall(data)


class Handler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        first = recv_headers(self.request)
        if not first:
            return
        header, _, body = first.partition(b"\r\n\r\n")
        lines = header.split(b"\r\n")
        parts = lines[0].decode("iso-8859-1", errors="replace").split()
        if len(parts) < 3:
            return
        method, target, version = parts[0].upper(), parts[1], parts[2]

        with socket.create_connection((UPSTREAM_HOST, UPSTREAM_PORT), timeout=30) as upstream:
            if method == "CONNECT":
                upstream.sendall(
                    f"CONNECT {target} {version}\r\n".encode("iso-8859-1")
                    + auth_header()
                    + b"Proxy-Connection: keep-alive\r\n\r\n"
                )
                response = recv_headers(upstream)
                self.request.sendall(response)
                if b" 200 " in response.split(b"\r\n", 1)[0]:
                    pipe(self.request, upstream)
                return

            filtered = strip_proxy_headers(header).split(b"\r\n")
            if not (target.startswith("http://") or target.startswith("https://")):
                host = ""
                for line in lines[1:]:
                    if line.lower().startswith(b"host:"):
                        host = line.split(b":", 1)[1].strip().decode("iso-8859-1")
                        break
                target = f"http://{host}{target}"
            filtered[0] = f"{parts[0]} {target} {version}".encode("iso-8859-1")
            upstream.sendall(
                b"\r\n".join(filtered)
                + b"\r\n"
                + auth_header()
                + b"Proxy-Connection: keep-alive\r\n\r\n"
                + body
            )
            pipe(self.request, upstream)


class Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server((LISTEN_HOST, LISTEN_PORT), Handler) as server:
        server.serve_forever()
