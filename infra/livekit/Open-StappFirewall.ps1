[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$adapter = 'Radmin VPN'
$address = Get-NetIPAddress -InterfaceAlias $adapter -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -like '26.*' } |
    Select-Object -First 1
if (-not $address) {
    throw 'O Radmin VPN nao esta conectado ou nao possui um endereco 26.x.x.x.'
}

$common = @{
    Group = 'Stapp'
    Direction = 'Inbound'
    Action = 'Allow'
    Enabled = 'True'
    Profile = 'Private'
    InterfaceAlias = $adapter
    LocalAddress = $address.IPAddress
    RemoteAddress = '26.0.0.0/8'
    EdgeTraversalPolicy = 'Block'
}

if (-not (Get-NetFirewallRule -DisplayName 'Stapp Radmin TCP' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule @common -DisplayName 'Stapp Radmin TCP' `
        -Protocol TCP -LocalPort 8787,7880,7881 | Out-Null
}
if (-not (Get-NetFirewallRule -DisplayName 'Stapp Radmin UDP Media' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule @common -DisplayName 'Stapp Radmin UDP Media' `
        -Protocol UDP -LocalPort 7882 | Out-Null
}

Get-NetFirewallRule -DisplayName 'Stapp Radmin *' |
    Select-Object DisplayName, Enabled, Direction, Action, Profile
