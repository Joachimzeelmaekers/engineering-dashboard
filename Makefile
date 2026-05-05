.PHONY: help install report serve open clean dev build

OUTPUT_DIR := output

help:
	@printf "%s\n" "Targets:" \
		"  install - Install dashboard dependencies" \
		"  report  - Generate dashboard data JSON" \
		"  dev     - Generate data and start Astro dev server" \
		"  build   - Build static Astro dashboard" \
		"  serve   - Generate data, build, and preview Astro dashboard" \
		"  open    - Open Astro dashboard URL in browser" \
		"  clean   - Remove output/ directory"

install:
	cd dashboard && yarn install

report:
	@mkdir -p $(OUTPUT_DIR)
	python3 main.py

dev: report
	cd dashboard && yarn dev

build: report
	cd dashboard && yarn build

serve:
	@printf "Building + previewing dashboard at http://localhost:4321\n"
	python3 serve.py

open:
	@open http://localhost:4321

clean:
	rm -rf $(OUTPUT_DIR)
