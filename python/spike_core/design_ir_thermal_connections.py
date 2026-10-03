"""DesignIR compatibility imports for external consumers. Internals use spider_thermal_connections."""
from . import spider_thermal_connections as _implementation
from .spider_thermal_connections import *  # noqa: F401,F403

def __getattr__(name):
    return getattr(_implementation, name)
