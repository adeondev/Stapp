[CmdletBinding()]
param(
    [string]$InterfaceAlias = '',
    [string]$Profile = 'Private'
)

$ErrorActionPreference = 'Stop'

$common = @{
    Group = 'Stapp'
    Direction = 'Inbound'
    Action = 'Allow'
    Enabled = 'True'
    Profile = $Profile
    EdgeTraversalPolicy = 'Block'
}

if ($InterfaceAlias) {
    $common['InterfaceAlias'] = $InterfaceAlias
}

if (-not (Get-NetFirewallRule -DisplayName 'Stapp TCP (API, Web, LiveKit)' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule @common -DisplayName 'Stapp TCP (API, Web, LiveKit)' `
        -Protocol TCP -LocalPort 8787,7880,7881 | Out-Null
}
if (-not (Get-NetFirewallRule -DisplayName 'Stapp UDP Media (LiveKit WebRTC)' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule @common -DisplayName 'Stapp UDP Media (LiveKit WebRTC)' `
        -Protocol UDP -LocalPort 7882 | Out-Null
}

Get-NetFirewallRule -DisplayName 'Stapp *' |
    Select-Object DisplayName, Enabled, Direction, Action, Profile
