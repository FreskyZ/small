
- a new web ui, a single file application
- inline all audio files as data url
- unify all tracks, fix typo, convert to opus

```py
import soundfile as sf
import pyloudnorm as pyln

# 1. Load the audio file
data, rate = sf.read("your_audio_file.wav")

# 2. Create meter with the sample rate
meter = pyln.Meter(rate)

# 3. Calculate integrated loudness
loudness = meter.loudness(data)
print(f"Integrated Loudness: {loudness:.2f} LUFS")
```
https://github.com/csteinmetz1/pyloudnorm

UPDATE ffmpeg seems have related functionalities, loudness normalization


## Develop Logs

step 1, download the repository and try to setup environment

- successfully run complete npm i with node 12 and npm 6
- cannot make npm run serve to work temporarily
- npm run build run successfully, serve static files run successfully
- make sure nearly all source files are not actually needed, after merging router.js and globalconst.js into
  main.js, only main.js, app.vue and home.vue is actually used, and their logic is extremely simple, and there
  is no other functionalities except the obvious display and play functionalities

step 2, setup this project

- create index.html template and design overall layout of the web page
- put in static elements into template, like about popup and other links
- setup make-page.ts to make first release of release asset mikibutt.html

step 3, collect data

- read original voices.json file, confirm data structure
- a few name and path inconsistency, many name and description inconsistency, source code shows name is only used
  internally in code, description is display text, path is path, only one item don't have matching file, cannot find
  reason in commit message, many files are not in config file, commit spread is not significant, should be random
  human error add up
- check audio files basic information
