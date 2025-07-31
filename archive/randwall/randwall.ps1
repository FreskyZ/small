Add-Type -AssemblyName System.Drawing

<#
.DESCRIPTION
    download random image from https://dev.iw233.cn/API/index.php and display, parameter may be
    random, iw233, top (recommend), yin (silver hair), cat, xing (stars), mp (vertical), pc (horizontal)
#>

# UPDATE 2025: service closed

function randwall {
    param(
        [Parameter(Position = 0)][string]$sort = "random"
    )
    $header = @{ 'Referer' = 'https://weibo.com' }
    try {
        $response = iwr https://iw233.cn/api.php?sort=$sort -Headers $header
    } catch {
        write-host "error:" $_.exception.message
        try {
            $response = iwr https://dev.iw233.cn/api.php?sort=$sort -Headers $header
        } catch {
            write-host "error:" $_.exception.message
            try {
                $response = iwr https://api.iw233.cn/api.php?sort=$sort -Headers $header
            } catch {
                write-host "error:" $_.exception.message
                return
            }
        }
    }
    $filename = [system.datetime]::now.tostring('yyMMdd-HHmmss') + '.jpg'
    Set-Content $filename -value $response.content -AsByteStream
    $filesize = $response.content.length / 1000
    if ($filesize -gt 1000) {
        $filesize = $filesize / 1000
        $filesize = [string]::format("{0:0.00}mb", $filesize)
    } else {
        $filesize = [string]::format("{0:0.00}kb", $filesize)
    }
    $filepath = (resolve-path $filename).path
    $image = new-object system.drawing.bitmap $filepath
    [string]::format("{0} {1}x{2} {3}", $filename, $image.width, $image.height, $filesize)
    $image.dispose()
    Start-Process $filename
}
