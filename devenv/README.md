## Development Environment Automation

some of my development environment

- base images
  - Dockerfile: node, rust, python, and a generic shell
  - llvm/Dockerfile: build llvm from source
  - llvm/CDE.md: details and stories about build llvm from source
- dev containers
  - fine/.devcontainer.json: fine dev container (https://github.com/FreskyZ/fine), but not used for long time?
  - llvm/.devcontainer.json: c++ dev container, but not actually used yet?
  - DEC.md: details and some stories about vscode dev container
- docker host (the machine to run docker)
  - host/make-shell-setup.py: prepare for setup shell for docker host
  - host/docker-setup.py: manually install docker
  - host/docker-setup.md: details and some stories about docker setup
- dev virtual machines
  - windows/DEC.md: details about windows virtual machine for development or other purpose
