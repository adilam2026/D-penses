#!/usr/bin/env python3
"""Résume un dump uiautomator (adb shell uiautomator dump) en lignes lisibles
dans le log console CI — le téléchargement direct de l'artefact ZIP depuis le
stockage blob Azure est bloqué par la politique de l'egress proxy de cette
session, donc l'inspection doit passer par le texte du log de job plutôt que
par le fichier XML lui-même. Utilise un vrai parseur XML (et non une regex sur
des balises auto-fermantes) car les noeuds uiautomator qui ont des enfants
(ex. une case de tableau qui enveloppe un <Text>) ne sont jamais auto-fermants
et étaient silencieusement ignorés par une version précédente de ce script."""
import sys
import xml.etree.ElementTree as ET


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: dump-ui-summary.py <hierarchy.xml> [keyword]")
        sys.exit(1)
    path = sys.argv[1]
    keyword = sys.argv[2].lower() if len(sys.argv) > 2 else None

    tree = ET.parse(path)
    nodes = list(tree.getroot().iter("node"))
    packages = sorted({n.get("package", "") for n in nodes if n.get("package")})
    print(f"Fichier: {path}")
    print(f"Nombre total de noeuds: {len(nodes)}")
    print(f"Paquets presents dans la hierarchie: {', '.join(packages) if packages else '(aucun)'}")

    interesting = []
    for n in nodes:
        text = n.get("text", "")
        rid = n.get("resource-id", "")
        cls = n.get("class", "")
        desc = n.get("content-desc", "")
        clickable = n.get("clickable", "")
        hay = f"{text} {rid} {cls} {desc}".lower()
        if keyword and keyword not in hay:
            continue
        if not keyword and not (text or rid or desc or clickable == "true"):
            continue
        interesting.append((cls, text, rid, desc, clickable, n.get("bounds", ""), n.get("visible-to-user", "")))

    label = f"filtre='{keyword}'" if keyword else "texte/resource-id/content-desc/clickable non vides"
    print(f"Noeuds pertinents ({label}): {len(interesting)}")
    for cls, text, rid, desc, clickable, bounds, visible in interesting[:120]:
        print(f"  class={cls} | text={text!r} | resource-id={rid} | content-desc={desc!r} | clickable={clickable} | visible-to-user={visible} | bounds={bounds}")


if __name__ == "__main__":
    main()
