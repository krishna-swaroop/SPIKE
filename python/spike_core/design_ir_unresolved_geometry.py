"""DesignIR compatibility imports for external consumers. Internals use spider_unresolved_geometry."""
from . import spider_unresolved_geometry as _implementation
from .spider_unresolved_geometry import *  # noqa: F401,F403

def __getattr__(name):
    return getattr(_implementation, name)
