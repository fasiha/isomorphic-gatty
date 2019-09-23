TSSRC=$(wildcard *.ts)
JSSRC=$(TSSRC:.ts=.js)

all: index.bundle.min.js test-browser.bundle.js

%.js: %.ts
	npm run build

index.bundle.js: $(JSSRC)
	npm run dist
	echo done

index.bundle.min.js: index.bundle.js
	npm run min

# Assumes VS Code is running in watch build mode
watch:
	fswatch -0 -o -l .1 $(JSSRC) | xargs -0 -n 1 -I {} make

test-browser.bundle.js: test-browser.js index.js
	npm run browser
