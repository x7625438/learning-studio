$proxyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$scriptPath = 'D:\learning_website\ops\vps_local_http_proxy.py'

$existing = Get-NetTCPConnection -LocalPort 18080 -ErrorAction SilentlyContinue |
  Select-Object -First 1

if (-not $existing) {
  Start-Process -FilePath 'pythonw.exe' -ArgumentList $scriptPath -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

Set-ItemProperty -Path $proxyPath -Name ProxyEnable -Value 1
Set-ItemProperty -Path $proxyPath -Name ProxyServer -Value '127.0.0.1:18080'
Remove-ItemProperty -Path $proxyPath -Name AutoConfigURL -ErrorAction SilentlyContinue

$signature = @'
[DllImport("wininet.dll", SetLastError = true)]
public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
'@
$type = Add-Type -MemberDefinition $signature -Name WinInetOptionsEnableVps -Namespace Native -PassThru
$type::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
$type::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null

Get-ItemProperty -Path $proxyPath | Select-Object ProxyEnable,ProxyServer,AutoConfigURL
