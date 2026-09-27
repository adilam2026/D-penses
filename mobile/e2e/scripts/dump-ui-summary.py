#!/usr/bin/env python3
"""Résume un dump uiautomator (adb shell uiautomator dump) en lignes lisibles
dans le log console CI — le téléchargement direct de l'artefact ZIP depuis le
stockage blob Azure est bloqué par la politique de l'egress proxy de cette
session, donc l'inspection doit passer par le texte du log de job plutôt que
par le fichier XML lui-même."""
import re
import sys


def attr(node: str, name: str) -> str:
    m = re.search(rf'{name}="([^"]*)"', node)
    return m.group(1) if m else ""


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: dump-ui-summary.py <hierarchy.xml> [keyword]")
        sys.exit(1)
    path = sys.argv[1]
    keyword = sys.argv[2].lower() if len(sys.argv) > 2 else None

    with open(path, encoding="utf-8", errors="replace") as f:
        xml = f.read()

    nodes = re.findall(r"<node\b[^>]*/>", xml)
    packages = sorted(set(re.findall(r'package="([^"]*)"', xml)))
    print(f"Fichier: {path}")
    print(f"Nombre total de noeuds: {len(nodes)}")
    print(f"Paquets presents dans la hierarchie: {', '.join(packages) if packages else '(aucun)'}")

    interesting = []
    for node in nodes:
        text = attr(node, "text")
        rid = attr(node, "resource-id")
        cls = attr(node, "class")
        desc = attr(node, "content-desc")
        clickable = attr(node, "clickable")
        hay = f"{text} {rid} {cls} {desc}".lower()
        if keyword and keyword not in hay:
            continue
        if not keyword and not (text or rid or desc or clickable == "true"):
            continue
        interesting.append((cls, text, rid, desc, clickable, attr(node, "bounds"), attr(node, "visible-to-user")))

    label = f"filtre='{keyword}'" if keyword else "texte/resource-id/content-desc/clickable non vides"
    print(f"Noeuds pertinents ({label}): {len(interesting)}")
    for cls, text, rid, desc, clickable, bounds, visible in interesting[:120]:
        print(f"  class={cls} | text={text!r} | resource-id={rid} | content-desc={desc!r} | clickable={clickable} | visible-to-user={visible} | bounds={bounds}")


if __name__ == "__main__":
    main()
