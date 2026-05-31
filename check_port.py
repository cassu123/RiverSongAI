import psutil
for conn in psutil.net_connections():
    if conn.laddr.port == 8000:
        p = psutil.Process(conn.pid)
        print(p.pid, p.name(), p.cmdline())
