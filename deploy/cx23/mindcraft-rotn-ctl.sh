#!/usr/bin/env bash
# Root-owned control wrapper for the bot units, installed as /usr/local/sbin/mindcraft-rotn-ctl.
# The deploy user may run exactly this program with sudo (/etc/sudoers.d/mindcraft-rotn), never
# systemctl itself: a sudoers wildcard such as `systemctl restart mindcraft-rotn@*` would also match
# `restart mindcraft-rotn@x other.service`.
#
#   sudo mindcraft-rotn-ctl ACTION BOT     ACTION: start | stop | restart | status | is-active | is-enabled | enable | disable
#   sudo mindcraft-rotn-ctl list           the bots that have an env file in /etc/mindcraft-rotn
#   sudo mindcraft-rotn-ctl daemon-reload
#
# The paths are fixed on purpose: nothing in the caller's environment may change what root runs
# (PR #30 review finding 8). The offline tests run a copy with these two lines rewritten.
set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin

readonly SYSTEMCTL=/usr/bin/systemctl
readonly ETC_DIR=/etc/mindcraft-rotn
readonly BOT_RE='^[a-z0-9][a-z0-9-]{0,31}$'

die() { echo "mindcraft-rotn-ctl: $*" >&2; exit 2; }

action=${1:-}
case $action in
  list)
    (( $# == 1 )) || die "list takes no arguments"
    shopt -s nullglob
    for f in "$ETC_DIR"/*.env; do b=$(basename "$f" .env); [[ $b =~ $BOT_RE ]] && echo "$b"; done
    exit 0 ;;
  daemon-reload)
    (( $# == 1 )) || die "daemon-reload takes no arguments"
    exec "$SYSTEMCTL" daemon-reload ;;
  start|stop|restart|status|is-active|is-enabled|enable|disable)
    (( $# == 2 )) || die "usage: mindcraft-rotn-ctl $action BOT"
    bot=$2
    [[ $bot =~ $BOT_RE ]] || die "bad bot name '$bot' (lowercase letters, digits, '-', at most 32)"
    [[ -f $ETC_DIR/$bot.env ]] || die "no env file for '$bot' (run bootstrap.sh add-bot $bot)"
    extra=()
    [[ $action == status ]] && extra=(--no-pager)
    exec "$SYSTEMCTL" "$action" "${extra[@]}" "mindcraft-rotn@$bot.service" ;;
  *)
    die "usage: mindcraft-rotn-ctl {start|stop|restart|status|is-active|is-enabled|enable|disable} BOT | list | daemon-reload" ;;
esac
