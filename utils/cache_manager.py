"""File-based cache manager for yfinance data."""
import json
import os
import pickle
import time

from utils.logger import log


class CacheManager:
    def __init__(self, cache_dir, default_expiry_hours=24):
        self.cache_dir = cache_dir
        self.default_expiry_hours = default_expiry_hours
        os.makedirs(cache_dir, exist_ok=True)

    def _symbol_dir(self, symbol):
        safe = symbol.replace(".", "_").replace("^", "_")
        path = os.path.join(self.cache_dir, safe)
        os.makedirs(path, exist_ok=True)
        return path

    def _meta_path(self, symbol, data_type):
        return os.path.join(self._symbol_dir(symbol), f"{data_type}.meta.json")

    def _data_path(self, symbol, data_type):
        ext = ".json" if data_type == "info" else ".pkl"
        return os.path.join(self._symbol_dir(symbol), f"{data_type}{ext}")

    def is_valid(self, symbol, data_type, expiry_hours=None):
        """Check if cached data exists and is not expired."""
        meta_path = self._meta_path(symbol, data_type)
        data_path = self._data_path(symbol, data_type)

        if not os.path.exists(meta_path) or not os.path.exists(data_path):
            return False

        try:
            with open(meta_path, "r") as f:
                meta = json.load(f)
            exp = expiry_hours or meta.get("expiry_hours", self.default_expiry_hours)
            age_hours = (time.time() - meta["timestamp"]) / 3600
            return age_hours < exp
        except (json.JSONDecodeError, KeyError, OSError):
            return False

    def read(self, symbol, data_type, expiry_hours=None):
        """Read cached data. Returns None on miss or expiry."""
        if not self.is_valid(symbol, data_type, expiry_hours):
            return None

        data_path = self._data_path(symbol, data_type)
        try:
            if data_type == "info":
                with open(data_path, "r") as f:
                    return json.load(f)
            else:
                with open(data_path, "rb") as f:
                    return pickle.load(f)
        except (OSError, pickle.UnpicklingError, json.JSONDecodeError) as e:
            log.warning(f"Cache read error for {symbol}/{data_type}: {e}")
            return None

    def write(self, symbol, data_type, data, expiry_hours=None):
        """Write data to cache with timestamp metadata."""
        meta_path = self._meta_path(symbol, data_type)
        data_path = self._data_path(symbol, data_type)
        exp = expiry_hours or self.default_expiry_hours

        try:
            meta = {"timestamp": time.time(), "expiry_hours": exp}
            with open(meta_path, "w") as f:
                json.dump(meta, f)

            if data_type == "info":
                with open(data_path, "w") as f:
                    json.dump(data, f, default=str)
            else:
                with open(data_path, "wb") as f:
                    pickle.dump(data, f, protocol=pickle.HIGHEST_PROTOCOL)
        except OSError as e:
            log.warning(f"Cache write error for {symbol}/{data_type}: {e}")

    def invalidate(self, symbol=None):
        """Clear cache for one symbol or all."""
        import shutil
        if symbol:
            sym_dir = self._symbol_dir(symbol)
            if os.path.exists(sym_dir):
                shutil.rmtree(sym_dir)
        else:
            if os.path.exists(self.cache_dir):
                shutil.rmtree(self.cache_dir)
                os.makedirs(self.cache_dir, exist_ok=True)

    def get_stats(self):
        """Return cache statistics."""
        total = 0
        fresh = 0
        size_bytes = 0
        if not os.path.exists(self.cache_dir):
            return {"total_symbols": 0, "fresh": 0, "size_mb": 0}
        for entry in os.listdir(self.cache_dir):
            path = os.path.join(self.cache_dir, entry)
            if os.path.isdir(path):
                total += 1
                info_valid = self.is_valid(entry, "info")
                if info_valid:
                    fresh += 1
                for f in os.listdir(path):
                    fp = os.path.join(path, f)
                    if os.path.isfile(fp):
                        size_bytes += os.path.getsize(fp)
        return {
            "total_symbols": total,
            "fresh": fresh,
            "size_mb": round(size_bytes / (1024 * 1024), 1),
        }
