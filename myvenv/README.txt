# myvenv

This is one of my first rust projects and one of my first git tracked projects.

The commits are imported and amended and rebased into this repository,
so you can find 2016 commits in this 2023 created repository.

The previous commit to add TODO.txt is also faked, I left the file uncommitted for more than 6 years.

There is really many old things in this directory

- the commit author email is using fresky7, I stopped using this email address with unreasonable number for many years
- the Cargo.toml does not have edition field, which means this project is edition 2015
- the project amazingly nearly builds, or more precisely, rust part and llvm part passes correctly 
  but linker fails because it is linking windows system library symbols, which shows rust's incredible stablity
- a lot of try! macro is deprecated warning, I have really written many try macros,
  now try is a reserved keyword and r#try is needed if you really want that, I cannot easily imagine how rustc handles it
- a lot of struct initialization short hand warning by rust-analyzer, this feature does not exist at that time
- a lot of & and ref in match expression, at that time they are required 
  and they are daily fighting with rustc to balance match expression ref and match arm ref like nowadays (Jan 2023, rust 1.66)
  daily fighting with rusct to balance ref between 2 sides of equality operator
- different module system, relative import in current module needs crate:: prefix after edition 2018,
  I still remember how many time I spent when upgrading fff-lang from edition 2015 to edition 2018
- I'm parsing command line argument by myself, when I found clap and tries to claim it does not exist at that time, I found
  it actually exists for really very long time, like at 2015
- perror and perrorln is implemented by myself, eprint and eprintln is not available at that time
- there is a main_with_error function to wrap Result, returning Result in main is not allowed at that time

This project itself is not needed any more, it was mainly created because I was using many versions of python at that time,
especially python 2 and python 3 exists at the same time, but now python fixes that by using more specific name like python3 and python3.10,
another motivation is that I want to use visual studio tools command prompt in command line, not clicking that
in start menu (or start screen at that time?), now I rarely use visual studio and windows in my personal projects,
by the way, the not-included-in-motivation and not-used-at-that-time nodejs version issue is fixed by nvm

The original project name is env, current directory is myvenv, as it is really a venv program.
