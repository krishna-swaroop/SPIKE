"""DesignIR compatibility imports for external consumers. Internals use spider_v1_normalization."""
from . import spider_v1_normalization as _implementation
from .spider_v1_normalization import *  # noqa: F401,F403

def __getattr__(name):
    return getattr(_implementation, name)
