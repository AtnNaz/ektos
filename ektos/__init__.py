import warnings

from astropy import log as _log
from astropy.utils import iers as _iers

_iers.conf.auto_download = False
_iers.conf.iers_degraded_accuracy = "ignore"
_log.setLevel("ERROR")
warnings.filterwarnings("ignore", module="astropy")

__version__ = "0.1.0"
