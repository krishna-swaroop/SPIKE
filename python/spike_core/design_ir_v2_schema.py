"""DesignIR compatibility imports for external consumers. Internals use spider_v2_schema."""
from . import spider_v2_schema as _implementation
from .spider_v2_schema import *  # noqa: F401,F403

DESIGN_IR_V2_CONTRACT = _implementation.SPIDER_V2_CONTRACT

def __getattr__(name):
    return getattr(_implementation, name)
