"""DesignIR compatibility imports for external consumers. Internals use spider_land_profiles."""
from . import spider_land_profiles as _implementation
from .spider_land_profiles import *  # noqa: F401,F403

def __getattr__(name):
    return getattr(_implementation, name)
