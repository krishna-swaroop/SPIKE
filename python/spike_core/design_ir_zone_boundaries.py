"""DesignIR compatibility imports for external consumers. Internals use spider_zone_boundaries."""
from . import spider_zone_boundaries as _implementation
from .spider_zone_boundaries import *  # noqa: F401,F403

def __getattr__(name):
    return getattr(_implementation, name)
