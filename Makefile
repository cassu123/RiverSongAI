.PHONY: deploy dev logs status restart stop build

deploy:
	@bash deploy.sh

build:
	@cd frontend && npm run build

dev:
	@bash dev.sh

restart:
	@sudo systemctl restart river-song
	@sudo systemctl status river-song --no-pager -l

stop:
	@sudo systemctl stop river-song

status:
	@sudo systemctl status river-song --no-pager -l

logs:
	@sudo journalctl -u river-song -f --no-hostname
