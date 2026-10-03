"""DesignIR compatibility imports for external consumers. Internals use spider_v2."""
from . import spider_v2 as _implementation
from .spider_v2 import *  # noqa: F401,F403

DesignIRV2 = _implementation.SpiDeRV2
DesignIR = _implementation.SpiDeR
DESIGN_IR_V2_CONTRACT = _implementation.SPIDER_V2_CONTRACT

def __getattr__(name):
    return getattr(_implementation, name)
