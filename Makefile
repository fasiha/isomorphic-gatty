TSSRC=$(wildcard *.ts)
JSSRC=$(TSSRC:.ts=.js)

all: test.bundle.js

%.js: %.ts
	npm run build

test.bundle.js: $(JSSRC)
	npm run dist
	echo done

# Assumes VS Code is running in watch build mode
watch:
	fswatch -0 -o -l .1 $(JSSRC) | xargs -0 -n 1 -I {} make