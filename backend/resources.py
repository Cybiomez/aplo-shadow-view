"""
Ресурсы в реальном времени: загрузка сервера (ЦПУ/ОЗУ) и потребление по сеансам.

Источники загрузки сервера:
  - Zabbix (предпочтительно, если настроен) — метрики уже собраны, не грузит
    серверы; один HTTP к серверу мониторинга;
  - fallback: WMI/CIM по серверу (Win32_OperatingSystem память, Win32_Processor
    LoadPercentage).

Потребление по сеансам (ЦПУ/ОЗУ) Zabbix обычно не даёт — собираем на самом
сервере: агрегация процессов по SessionId (Win32_Process; RAM = сумма рабочего
множества, ЦПУ% — по разнице процессорного времени за короткий интервал).

Всё Windows-only; на других ОС — заглушки для отладки вида. Сбор тяжелее quser —
вызывать ТОЛЬКО для открытого по фильтрам и не слишком часто.
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.request

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


# ---------- Zabbix ----------

def _zabbix_call(url: str, token: str, method: str, params: dict) -> dict | list | None:
    payload = json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode()
    req = urllib.request.Request(
        url.rstrip("/") + "/api_jsonrpc.php", data=payload,
        headers={"Content-Type": "application/json-rpc", "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.load(resp)
        return data.get("result")
    except Exception:
        return None


def _zabbix_load(url: str, token: str, server: str) -> dict | None:
    """ЦПУ% и ОЗУ% сервера из Zabbix по hostname. None, если недоступно."""
    hosts = _zabbix_call(url, token, "host.get",
                         {"filter": {"host": [server]}, "output": ["hostid"]})
    if not hosts:
        return None
    hostid = hosts[0]["hostid"]
    items = _zabbix_call(url, token, "item.get", {
        "hostids": hostid,
        "search": {"key_": "system.cpu.util"},
        "output": ["lastvalue", "key_"],
    }) or []
    mem = _zabbix_call(url, token, "item.get", {
        "hostids": hostid,
        "search": {"key_": "vm.memory.size[pavailable]"},
        "output": ["lastvalue", "key_"],
    }) or []
    cpu = None
    for it in items:
        if it.get("key_", "").startswith("system.cpu.util"):
            try:
                cpu = round(float(it["lastvalue"]))
            except (ValueError, KeyError):
                pass
            break
    ram_pct = None
    for it in mem:
        try:
            ram_pct = round(100 - float(it["lastvalue"]))  # pavailable → занято
        except (ValueError, KeyError):
            pass
        break
    if cpu is None and ram_pct is None:
        return None
    return {"cpu": cpu, "ram_pct": ram_pct, "source": "zabbix"}


# ---------- WMI fallback ----------

_PS_SERVER_LOAD = (
    "$ErrorActionPreference='SilentlyContinue';"
    "$os=Get-CimInstance Win32_OperatingSystem {cn};"
    "$cpu=(Get-CimInstance Win32_Processor {cn} | Measure-Object -Property LoadPercentage -Average).Average;"
    "$total=$os.TotalVisibleMemorySize; $free=$os.FreePhysicalMemory;"
    "$used=[math]::Round(($total-$free)/1024); $tot=[math]::Round($total/1024);"
    "$rp=if($total){[math]::Round(($total-$free)/$total*100)}else{0};"
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
    "Write-Output (ConvertTo-Json @{cpu=[int]$cpu; ram_pct=[int]$rp; ram_used_mb=$used; ram_total_mb=$tot})"
)


def _wmi_load(server: str) -> dict | None:
    cn = f"-ComputerName {server}" if server else ""
    script = _PS_SERVER_LOAD.replace("{cn}", cn)
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                             capture_output=True, timeout=15, creationflags=_NO_WINDOW)
        data = json.loads(out.stdout.decode("utf-8", errors="replace") or "{}")
        data["source"] = "wmi"
        return data
    except Exception:
        return None


# ---------- публичное API ----------

def server_load(server: str, zabbix_url: str = "", zabbix_token: str = "") -> dict:
    """{cpu, ram_pct, ram_used_mb?, ram_total_mb?, source} или {source:'none'}."""
    if sys.platform != "win32":
        # демо-нагрузка на не-Windows (детерминированно от имени сервера)
        h = sum(ord(c) for c in server) if server else 40
        return {"cpu": h % 90, "ram_pct": (h * 3) % 95, "source": "demo"}
    if zabbix_url and zabbix_token:
        z = _zabbix_load(zabbix_url, zabbix_token, server)
        if z:
            return z
    w = _wmi_load(server)
    return w or {"source": "none"}


_PS_SESSION_RES = r"""
$ErrorActionPreference='SilentlyContinue'
$cn = "{cn}"
function Snap { if($cn){ Get-CimInstance Win32_Process -ComputerName $cn } else { Get-CimInstance Win32_Process } }
$a = Snap
Start-Sleep -Milliseconds 600
$b = Snap
$cores = (Get-CimInstance Win32_ComputerSystem {cnflag}).NumberOfLogicalProcessors
if(-not $cores){$cores=1}
$prevT = @{}; foreach($p in $a){ $prevT[$p.ProcessId] = [double]$p.KernelModeTime + [double]$p.UserModeTime }
$bySess = @{}
foreach($p in $b){
  $sid = [int]$p.SessionId
  if(-not $bySess.ContainsKey($sid)){ $bySess[$sid] = @{ ram=0.0; cpu=0.0 } }
  $bySess[$sid].ram += [double]$p.WorkingSetSize
  $now = [double]$p.KernelModeTime + [double]$p.UserModeTime
  $prev = if($prevT.ContainsKey($p.ProcessId)){ $prevT[$p.ProcessId] } else { $now }
  $bySess[$sid].cpu += ($now - $prev)
}
$res = @{}
foreach($k in $bySess.Keys){
  $ramMb = [math]::Round($bySess[$k].ram/1MB)
  # процессорное время в 100-нс единицах за 0.6с; переводим в % от всех ядер
  $cpuPct = [math]::Round(($bySess[$k].cpu / 1e7) / (0.6 * $cores) * 100)
  if($cpuPct -lt 0){$cpuPct=0}; if($cpuPct -gt 100){$cpuPct=100}
  $res["$k"] = @{ ram_mb=$ramMb; cpu_pct=[int]$cpuPct }
}
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Write-Output (ConvertTo-Json $res -Compress)
"""


def session_resources(server: str) -> dict:
    """{sid(str): {ram_mb, cpu_pct}} — потребление по сеансам. {} если не собрать."""
    if sys.platform != "win32":
        return {}  # демо: в мосте есть свои значения
    cn = server or ""
    script = _PS_SESSION_RES.replace("{cn}", cn).replace("{cnflag}", f"-ComputerName {server}" if server else "")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                             capture_output=True, timeout=20, creationflags=_NO_WINDOW)
        return json.loads(out.stdout.decode("utf-8", errors="replace") or "{}")
    except Exception:
        return {}
