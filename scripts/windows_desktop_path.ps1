# SPDX-License-Identifier: Apache-2.0
function Get-SpikeInstalledDesktopPath {
    param([Parameter(Mandatory = $true)][string]$InstallRoot)

    # Cargo's default-run binary is the desktop entrypoint. Worker/helper EXEs
    # elsewhere in the installed tree are not alternative desktop entrypoints.
    $desktopPath = [System.IO.Path]::GetFullPath((Join-Path $InstallRoot "spike-desktop.exe"))
    if (-not (Test-Path -LiteralPath $desktopPath -PathType Leaf)) {
        throw "The installed SPIKE desktop executable is missing: $desktopPath"
    }
    return $desktopPath
}
