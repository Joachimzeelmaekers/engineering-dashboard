.PHONY: help report serve open clean

OUTPUT_DIR := output

help:
	@printf "%s\n" "Targets:" \
		"  report - Generate output/latest.html from all provider data" \
		"  serve  - Start local server, regenerates report on each request" \
		"  open   - Open latest report in browser" \
		"  clean  - Remove output/ directory"

report:
	@mkdir -p $(OUTPUT_DIR)
	python3 main.py

serve: report
	@printf "Starting server at http://localhost:9999\n"
	@printf "Refresh browser to regenerate report\n"
	python3 serve.py

open: report
	@open output/latest.html

clean:
	rm -rf $(OUTPUT_DIR)
