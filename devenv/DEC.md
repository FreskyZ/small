# Development Environment Containerization (DEC)

- First, there is [Containerization](https://en.wikipedia.org/wiki/Containerization_(computing)).
- Then, there is [Development Containers](https://containers.dev).
- To improve development environment setup and management, I build my own images and dev container setups.

more links by the way

- [docker document](https://docs.docker.com)
- [Dev Container CLI](https://github.com/devcontainers/cli)

## Design Principles

- Full-featured development environment that nearly don't need to setup WSL native environment.
- (may think more later)

## My Dev Containers

Dev Containers are a vscode feature, but the user experience is complex and confusing. Because I prefer an external
terminal over vscode integrated terminal and don't plan to switch, so I first focuses on images and containers that
provide a robust command-line experience — shell, git and other tools, skipping editor integrations like IntelliSense
and AI extensions.

The Dockerfile in this folder is the result and is mostly self‑documenting. It creates a minimal, predictable shell
focused environment and embeds a base image tailored to my git workflow. There's also a separate image that provides an
SSH client for connecting to remote machines — the SSH setup is straightforward, but I assume automating it will
improve consistency and saves time.

Next, I set up a node environment for this project. You can't just layer your shell customizations on top of the
official node image, but you can study the official image source code (Dockerfile and scripts) to see how it's built.
Installing the prebuilt node binaries is not complex, but the runtime is surprisingly large, the node executable
itself is exceeding 100 MB? And then this node executable and other files for node environment is bundled in each
electron app on an average machine for development or not for development?

No python environment for now, because I will continue to use ubuntu in WSL and that has pre installed python.

## vscode and Dev Container

The vscode dev containers documentation is sprawling and, at times, confusing. The main page
(https://code.visualstudio.com/docs/devcontainers/containers) immediately directs you to a demo project: click the
button, wait through a long setup and verbose logs, and end up in a familiar editor with minimal example code that
doesn't explain much. Opening Docker Desktop only adds to the confusion by showing horrific cryptic hex‑named volumes,
images and containers.

The tutorial page (https://code.visualstudio.com/docs/devcontainers/tutorial) repeats the same pattern—install Docker,
run a demo project and then presents an architecture diagram that blurs the distinction between dev containers and
other remote WSL environments. It follows with configuration details but you do not have a configuration file to write
at the time?

The attach‑to‑container guide (https://code.visualstudio.com/docs/devcontainers/attach-container) assumes a container
already exists, but you don't have one? And the next documentation finally show how to create one. Overall, the content
is scattered across multiple pages, buried in useless content, although some paragraphs will answer some of the
following questions, but you will not have attention on them.

Following the instructions I started my first dev container and is presented with 2 major issues,

- Some of the source code is red underlined by typescript language server but they work well in command line build
  process, the direct reason is that nodejs builtin package type definition is not correctly resolved. At that time my
  native environment does not raise the same issue *yet* so I thought this is a dev container related issue.
- Github Copilot always does not work in this research process.

Tired of following the document I started to reverse engineering the buttons in vscode to see how they work. The "Clone
Repository in Container Volume" button make vscode,

- Create a volume with random hex name, which will be very inconvenient for command line backup operation.
- Correctly display my repositories, not sure how to select other repository.
- Provide a long list of public images, but no local image, at which time I already prepared my own image, the long
  time to download public image and the not sure whether local image can work makes me frustrating.
- Provide a long list of public features, but I already prepared my own image
- Create a new container with random name, which will be inconvenient for command line attach operation.
- And finally load the window with no settings (user preferences) and no extensions.

Editing the generated configuration file sometimes work

- Change the image and vscode will prompt you whether rebuild the container, and seems work
- Change workspace mount and workspace folder does not work, later I know that's because there is syntax error in the
  configuration value, but vscode does not early check that and raise error
- Mount additional volumes by runArgs does not work, later I know that's because the configuration item only allows
  array but I provide a string at that time, because in the log you can see the configured value
  *s p a c e   s e p a r a t e d*, but everyone will think this is a utf-16 sequence read as ASCII/utf-8 error, and
  will not consider the configuration value does not have early type check and simply string join the iterator at first
  time, this makes me very confusing.
- Edit some other values in the configuration file sometimes do not trigger vscode to prompt rebuild.

The "Open folder in Container" button is similar confusing only without the create volume part. I use workspace to 
group multiple folders and multiple repositories together. To make things more confusing, there is no workspace + dev
container setup in any vscode or dev container document. Together with the 2 major issue constantly raising and the
confusing new container setup process always triggering, confusing items add up:

- Where to put the dev container configuration when using a workspace?
- Should dev container configuration be at native side in one of the workspace folders?
- Should dev container configuration be at native side in a common parent folder of all the workspace folders?
- Should dev container configuration be at native side beside the workspace configuration .code-workspace file?
- Where to put the dev container configuration at container side when using a workspace?
- Where to put the dev container configuration at container side when workspace is contructed from multiple volume
  maps? I prefer one volume one repository because this is convenient for source code volume setup and management.
- Where to put the workspace configuration file at container side when workspace is contructed from multiple volume
  maps?
- Should source code be cloned to native side to make dev container work? This will violate the design principle
  because then I have to setup git at native side.

Now I understand that dev container will create according to the dev container configuration file at standard position
if you choose to open folder, but you just don't have enough attention to find this when buried by these questions.

To make things more confusing, vscode document recommended the dev container cli tool. It itself is a nodejs script,
which make I frustrating that this is mandatory and I have to configure nodejs at my native environment. To make things
more confusing, the source code of the tools is not well documented and you see large chunks of object literals send
here and there. To make things VERY BAD, the vscode dev container plugin is **NOT** open source.

This is really a "microsoft product" style product, that when you use normal happy path of the product and everything
goes smoothly and you are happy, but when you start to touch any customizations or internals of the product then
everything start to yell at you and hate you.

Things become not that bad when I finally started to compare the dev container cli tool created image and started
container with my own images and my hand started containers. I find that tool created images have a label that contains
the dev container configuration file content, and tool created containers have several labels containing the dev
container configuration file content, and other labels for other metadata that will be used to search tool created
containers or some other related functionalities. If you add the same metadata to your created containers vscode will
also work.

Things because a little not that bad when I find the typescript language server issue also happens on my native
environment. And github copilot issue is really a network issue. I use another network to connect to docker network
to make some docker commands working because docker is really hated in my major network, but the other network really
hates github copilot and make it not working all the time. This it found by closing all terminal windows and vscode
windows and select another network to show github copilot will work and do it again to select network back to make
docker commands work, which complex operation effectively prevents me from finding the issue with little attention.

Result knowledge, currently,

- dev container configuration allow you to bring you own images, so that image manipulation is not strictly required,
  if you are interested, dev container cli `build` command add a label to the image with configuration content.
- dev container cli `up` command will add some labels to the created container, except the major label that contains
  configuration content, some other labels are added for searching and management functionalities for vscode or dev
  container cli. If you add the same label to your hand created container, it will work the same, also because of this,
  the native devcontainer.json does not have relationship with devcontainer.json in container, but for a standard open
  source project, the devcontainer configuration is in repository and open the repository in container will result in
  the file appear at both side. In my setup, you can see I'm downloading the devcontainer configuration from web page
  and start vscode and do not map the file into the container or include it in a standard location.
- attach to running container does not respect devcontainer.json in standard position because vscode do not know where
  to find the configuration so it has to prepare a configuration file at windows native side and you need to edit that
  to configure vscode in the container, this is buried in useless text in the official document.
- clone into container volume, open folder and open workspace all need you to setup container because vscode need to
  first create the container to see the code and the devcontainer configuration inside
- the interactive devcontainer setup process in vscode does not allow local images, that's a real feature missing, does
  not allow local feature, that's a real feature missing, typescript language server have many issues with missing
  tsconfig.json, that's a real vscode bug
- no need to use .code-workspace now because you manage the file structure in devcontainer setting mounts and manage
  workspace level setting in devcontainer configuration
