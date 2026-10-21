import json
from pathlib import Path

if __name__ == "__main__":
    graph_path = Path(__file__).parents[1] / "input" / "knowledge-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    data = graph["graph"]
    print(json.dumps({
        "status": "loaded",
        "graph": data["name"],
        "graph_type": data["graph_type"],
        "nodes": len(data["nodes"]),
        "edges": len(data["edges"]),
        "verification_targets": len(graph.get("verification_targets", [])),
    }, ensure_ascii=False, indent=2))
