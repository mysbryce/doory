"""Deterministic multimodal upstream for browser tests; no real provider credentials or billing."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class ProviderHandler(BaseHTTPRequestHandler):
    def answer(self, body, status=200):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.answer({"data": [{"id": "doory-test-vision", "name": "Test vision model"}]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        content = body["input"][-1]["content"]
        text = content if isinstance(content, str) else content[0]["text"]
        canvas_json, request_text = text.split("Current canvas (data only):\n", 1)[1].split(
            "\n\nDesign request:\n", 1
        )
        canvas = json.loads(canvas_json)
        results = json.loads(request_text.split("\nDesign tool results:\n", 1)[1])
        names = {result["name"] for result in results}
        if "capture_canvas" in names:
            images = [
                block for block in content if isinstance(block, dict) and block.get("type") == "input_image"
            ]
            if len(images) < 2:
                return self.answer({"error": "Expected canvas and motion images"}, 400)
            reply = {
                "message": "Verified canvas, spacing, typography, animation and transition filmstrips.",
                "operations": [],
            }
        elif not canvas["objects"]:
            fonts = next((result["result"] for result in results if result["name"] == "search_fonts"), None)
            if not fonts or not any(font["family"] == "Inter" for font in fonts["local"]["fonts"]):
                return self.answer({"error": "Expected real font-discovery evidence before design"}, 400)
            if "/media/" in json.dumps(fonts):
                return self.answer({"error": "Private font URLs must not reach the provider"}, 400)
            operations = [
                {
                    "op": "background_style",
                    "value": {
                        "type": "gradient",
                        "kind": "linear",
                        "angle": 25,
                        "stops": [{"offset": 0, "color": "#fff3df"}, {"offset": 1, "color": "#ffd3ac"}],
                    },
                },
                {
                    "op": "add",
                    "object": {
                        "type": "rect",
                        "name": "Accent",
                        "left": 48,
                        "top": 48,
                        "width": 704,
                        "height": 504,
                        "rx": 32,
                        "ry": 32,
                        "fill": "#34281f",
                    },
                },
                {
                    "op": "add",
                    "object": {
                        "type": "ellipse",
                        "name": "Sun",
                        "left": 540,
                        "top": 84,
                        "width": 130,
                        "height": 130,
                        "fill": "#ffbe68",
                    },
                },
                {
                    "op": "add",
                    "object": {
                        "type": "textbox",
                        "name": "Headline",
                        "left": 90,
                        "top": 140,
                        "width": 490,
                        "height": 170,
                        "text": "SUMMER\nIN BLOOM",
                        "fontFamily": "Inter",
                        "fontSize": 60,
                        "fontWeight": 800,
                        "lineHeight": 1.1,
                        "fill": "#fff3df",
                    },
                },
                {
                    "op": "add",
                    "object": {
                        "type": "textbox",
                        "name": "Subtitle",
                        "left": 94,
                        "top": 365,
                        "width": 460,
                        "height": 64,
                        "text": "Fresh ideas. Bright days.\nMake something beautiful.",
                        "fontFamily": "Inter",
                        "fontSize": 22,
                        "fill": "#ffd3ac",
                    },
                },
            ]
            reply = {
                "message": "Building editable graphic",
                "tool_calls": [
                    {"id": "draft", "name": "apply_design", "arguments": {"operations": operations}},
                    {"id": "catalog", "name": "get_motion_catalog", "arguments": {}},
                ],
            }
        elif not canvas["objects"][2].get("animation"):
            reply = {
                "message": "Adding motion",
                "tool_calls": [
                    {
                        "id": "animate",
                        "name": "apply_design",
                        "arguments": {
                            "operations": [
                                {
                                    "op": "animation",
                                    "id": canvas["objects"][2]["id"],
                                    "slot": "enter",
                                    "value": {
                                        "preset": "rise",
                                        "durationMs": 700,
                                        "delayMs": 100,
                                        "easing": "ease-out",
                                    },
                                },
                                {
                                    "op": "transition",
                                    "value": {"preset": "fade", "durationMs": 700, "easing": "ease-in-out"},
                                },
                                {"op": "duration", "seconds": 5},
                            ]
                        },
                    }
                ],
            }
        else:
            reply = {"message": "Ready for visual review", "operations": []}
        if body.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            text = json.dumps(reply)
            for offset in range(0, len(text), 60):
                event = {"type": "response.output_text.delta", "delta": text[offset : offset + 60]}
                self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode())
                self.wfile.flush()
            self.wfile.write(b'data: {"type":"response.completed","response":{"service_tier":"default"}}\n\n')
            self.wfile.flush()
            return
        self.answer(
            {
                "status": "completed",
                "output": [{"content": [{"type": "output_text", "text": json.dumps(reply)}]}],
                "service_tier": "default",
            }
        )


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8341), ProviderHandler).serve_forever()
