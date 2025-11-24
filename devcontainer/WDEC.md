
## Windows Side Development Environment Containerization

use Hyper-V should be more performance and easier to automate than VMware or VirtualBox

1. before create vm, setup virtual switch

```powershell
# show current available switches
Get-VMSwitch
# it seems only an internal switch is default created
# while it seems need external switch to connect to external network
# so need to create a external switch
# -NetAdapterName: comes from Get-NetAdapter
#   choose status=up, exclude description with "...virtual..." or bluetooth
#   it seems to be the wifi hardware name you are using
New-VMSwitch -Name "External Switch" -NetAdapterName $netadaptername -AllowManagementOS $ture
# connect new switch to existing vm if need
Connect-VMNetworkAdapter -VMName $vmname -SwitchName "External Switch"
```

2. create vm

```powershell
$vmname = "vmname"
# -Generation: should use 2, but document does not say default value, so explicitly specify this
# -NewVHDPath: create new vhd, size can expand later
# -Path: will create `Snapshots` and `Virtual Machines` folders in basepath/$vmname/ folder
#   along with the basepath/$vmname/Virtual Hard Disks/$vmname.vhdx vhdx path, will make the file structure short and clear
# -SwitchName: seems need an external switch
New-VM
  -Name $vmname
  -Generation 2
  -NewVHDPath "$($env:USERPROFILE)/HyperV/$($vmname)/Virtual Hard Disks/$($vmname).vhdx"
  -NewVHDSizeBytes 64GB
  -Path "$($env:USERPROFILE)/HyperV"
  -SwitchName "External Switch"
# setup memory
# note that if you set max bytes to 16gb while your vm is only using like 6GB,
# there will be a 10GB gap between committed memory and actual use memory in host machine's taskmgr,
# which will cause other memory consuming applications to cannot allocate more memory
# this cannot be configured and memory is not returned even if you close the vm,
# at the time of writing (2025 Nov) DDR memory is extremely expensive
# and I cannot upgrade my computer to 64GB or more so this is restricted to 8GB
Set-VM -Name $vmname -MemoryStartupBytes 4GB -DynamicMemory -MemoryMaximumBytes 8GB
# disable automatic checkpoint
Set-VM -Name $vmname -AutomaticCheckpointsEnabled $false
# setup process, default is 1 while modern windows need at least 2
# enable nested virtualization by the way
Set-VMProcessor -VMName $vmname -Count 4 -ExposeVirtualizationExtensions $true
# modern windows need TPM
Set-VMKeyProtector -VMName $vmname -NewLocalKeyProtector
Enable-VMTPM -VMName $vmname
```

3. windows install media

Windows ISO file official download page
https://www.microsoft.com/en-us/software-download/windows11 is broken and does not provide the download URL,
use this tool https://msdl.gravesoft.dev/ instead, this tool provides microsoft.com based url so should be ok,
in case the web page disappears, the source code is at https://github.com/gravesoft/msdl

```powershell
Add-VMDvdDrive -VMName $vmname -Path "win11.iso"
# set boot order
Set-VMFirmware -VMName $vmname -FirstBootDevice (Get-VMDvdDrive -VMNAME $vmname)
```

similarly, use Shift+F10 and type start ms-cxh:localonly to use local account

To automate Windows setup
https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/automate-windows-setup?view=windows-11,
you need to edit ISO file or use a Windows PE drive, both of them are parts of Windows ADK

Windows ADK is at https://learn.microsoft.com/en-us/windows-hardware/get-started/adk-install,
this page downloads a `adksetup.exe` file, this installer has
a tutorial page https://learn.microsoft.com/en-us/windows-hardware/get-started/adk-offline-install
and a reference page https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-8.1-and-8/dn621910(v=win.10)
the reference page seems to be outdated and may be upgraded or removed? in future. 

The ISO file utility (or "CD-ROM and DVD-ROM Premastering Utility" as itself claims) has a document page
https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/oscdimg-command-line-options?view=windows-11,
but there is no document about which feature name to select in `adksetup` to include the tool, according to intuition and some other
search result, you should use `OptionId.DeploymentTools`, winpe is obviously `OptionId.WindowsPreinstallationEnvironment` by the way.
No other command line option is important for normal install: `adksetup /features OptionId.DeploymentTools`, the `oscdimg.exe` file
is at `C:\Program Files (x86)\Windows Kits\10\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg\oscdimg.exe`.

```powershell
# mount iso file
Mount-DiskImage "win11.iso"
# copy content
Copy-Item -Path "E:\*" -Destination "D:\ISOWorkspace" -Recurse
# dismount original iso file
Dismount-Image "win11.iso"
# add autounattend.xml
New-Item -Path D:\ISOWorkspace\autounattend.xml -ItemType File
# by the way, shrink install.wim if it contains not needed windows version
# first list all images
dism /get-wiminfo /wimfile:D:\ISOWorkspace\sources\install.wim
# then export one index
dism /export-image /sourceimagefile:D:\ISOWorkspace\sources\install.wim /sourceindex:4 /destinationimagefile:D:\win11pro.wim /destinationname:"Windows 11 Pro"
# oscdimg support iso9660/joliet/udf file system
# check file system by mounting the image and run this and check FileSystem property
# it seems that nowadays you should always use udf
Get-Volume E | Format-List
# -u2: use udf file system
# -o: optimize size (not output file name)
# -l: label, the drive display name when you mount the iso file, not important when installing
# -m: ignore max file size limit (what limit?)
# -h: include hidden file (will standard windows iso file include hidden file?)
oscdimg -u2 -bD:\ISOWorkspace\efi\microsoft\boot\efisys.bin -o -lUNATTENDED_WIN11 -m -h D:\ISOWorkspace D:\UnattendedWin11.iso
```

4. start, stop and connect

```powershell
Start-VM -Name $vmname
# force stop, is this needed after you correctly install windows and normally only clicks shutdown in start menu?
Stop-VM -Name $vmname -TurnOff
# connect
vmconnect $env:COMPUTERNAME $vmname
```

5. backup, restore, duplicate

TODO setup the automation script for this, for now I'm using Hyper-V Manager GUI,

```powershell
Checkpoint-VM -Name $vmname -SnapshotName $snapshotname
Restore-VMCheckpoint -VMName $vmname -Name $snapshotname
```

by the way, Hyper-V Manager GUI can start in win+R by virtmgmt.msc
