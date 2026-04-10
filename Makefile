.PHONY: help report serve open clean dev build

OUTPUT_DIR := output

help:
	@printf "%s\n" "Targets:" \
		"  report  - Generate data (JSON + legacy HTML)" \
		"  dev     - Start Astro dev server (run report first)" \
		"  build   - Build static Astro dashboard" \
		"  serve   - Start legacy HTML server" \
		"  open    - Open latest HTML report in browser" \
		"  clean   - Remove output/ directory"

report:
	@mkdir -p $(OUTPUT_DIR)
	python3 main.py

dev: report
	cd dashboard && yarn dev

build: report
	cd dashboard && yarn build

serve: report
	@printf "Starting server at http://localhost:9999\n"
	python3 serve.py

open: report
	@open output/latest.html

clean:
	rm -rf $(OUTPUT_DIR)
