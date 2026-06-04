$proxyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'

Set-ItemProperty -Path $proxyPath -Name ProxyEnable -Value 0
Set-ItemProperty -Path $proxyPath -Name ProxyServer -Value ''
Remove-ItemProperty -Path $proxyPath -Name AutoConfigURL -ErrorAction SilentlyContinue

Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'vps_local_http_proxy.py' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$signature = @'
[DllImport("wininet.dll", SetLastError = true)]
public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
'@
$type = Add-Type -MemberDefinition $signature -Name WinInetOptionsRestoreDirect -Namespace Native -PassThru
$type::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
$type::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null

Get-ItemProperty -Path $proxyPath | Select-Object ProxyEnable,ProxyServer,AutoConfigURL
