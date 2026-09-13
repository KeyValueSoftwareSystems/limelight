import ast
import pathlib
import sys

HERE = pathlib.Path(__file__).parent


def imported_at_top(tree):
    out = {}
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                out[alias.asname or alias.name.split(".")[0]] = node.lineno
    return out


def bound_in(fn):
    out = {}
    for node in ast.walk(fn):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node is not fn:
            continue
        targets = []
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
            targets = [node.target]
        elif isinstance(node, ast.For):
            targets = [node.target]
        for t in targets:
            for sub in ast.walk(t):
                if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Store):
                    out.setdefault(sub.id, sub.lineno)
    return out


def called_in(fn):
    out = {}
    for node in ast.walk(fn):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            out.setdefault(node.func.id, node.lineno)
    return out


def main():
    bad = []
    files = [p for p in sorted(HERE.glob("*.py")) if not p.name.endswith(".test.py")]
    for path in files:
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError as e:
            bad.append((path.name, "does not parse", str(e)))
            continue
        brought = imported_at_top(tree)
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                if node.name in brought:
                    bad.append((path.name, node.name,
                                f"imported line {brought[node.name]}, "
                                f"redefined as a function line {node.lineno}"))
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            bound, called = bound_in(node), called_in(node)
            for name in sorted(set(brought) & set(bound) & set(called)):
                bad.append((path.name, name,
                            f"imported line {brought[name]}, assigned line {bound[name]} "
                            f"inside {node.name}(), called line {called[name]} -- "
                            f"the call reaches the local, not the import"))
    for where, what, why in bad:
        print(f"  FAIL  {where}: {what!r}   {why}")
    if bad:
        print(f"\n{len(bad)} shadowed import(s). parts.sections and grain.held were "
              f"both reached this way and neither raised until it was called.")
    else:
        print(f"\nno import is shadowed in {len(files)} files")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
