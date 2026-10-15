#!/usr/bin/env python3
"""ADB system actions + Maestro UI + read-only Android SQLite snapshots on our AVD."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
APP = 'com.todaysrun.app'
SDK = Path(os.environ.get('ANDROID_HOME', Path.home() / 'Library/Android/sdk'))
ADB = str(SDK / 'platform-tools/adb')
MAESTRO = str(Path.home() / '.maestro/bin/maestro')
parser = argparse.ArgumentParser()
parser.add_argument('--device', default='emulator-5560')
parser.add_argument('cases', nargs='*', metavar='CASE')
args = parser.parse_args()
if any(name not in {'background','running-recovery','paused-recovery'} for name in args.cases):
    parser.error('Cases: background, running-recovery, paused-recovery')
ENV = dict(os.environ, JAVA_HOME=os.environ.get('JAVA_HOME', '/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home'))
ENV['PATH'] = str(SDK / 'platform-tools') + os.pathsep + ENV.get('PATH', '')
OUT = ROOT / 'results' / ('native-' + time.strftime('%Y%m%d-%H%M%S'))
OUT.mkdir(parents=True, exist_ok=False)
step = 0

def adb(*command):
    return subprocess.check_output([ADB, '-s', args.device, *command], text=True).strip()

if adb('emu', 'avd', 'name').splitlines()[0].strip() != 'TodaysRunMaestroApi35':
    raise SystemExit('Refusing native tests outside the disposable test AVD.')
if adb('shell', 'am', 'get-current-user') != '0':
    raise SystemExit('Unexpected Android user.')
if int(adb('shell', 'getprop', 'ro.build.version.sdk')) < 35:
    raise SystemExit('These native checks target Android 15+.')
adb('reverse', 'tcp:8088', 'tcp:8088')
adb('shell', 'run-as', APP, 'pwd')  # Fail before mutations if the APK cannot be inspected.
# Compile the read-only test tool from the already installed Android SDK; no app library is added.
classes = ROOT / 'results/tools/classes'
dex = ROOT / 'results/tools/dex'
classes.mkdir(parents=True, exist_ok=True)
dex.mkdir(parents=True, exist_ok=True)
subprocess.run([str(Path(ENV['JAVA_HOME'])/'bin/javac'), '--release','8','-cp',str(SDK/'platforms/android-35/android.jar'),'-d',str(classes),str(ROOT/'SqliteSnapshot.java')],check=True)
subprocess.run([str(SDK/'build-tools/35.0.0/d8'),'--min-api','30','--lib',str(SDK/'platforms/android-35/android.jar'),'--output',str(dex),str(classes/'SqliteSnapshot.class')],env=ENV,check=True)


def ui(name):
    global step
    step += 1
    subprocess.run([MAESTRO, '--device', args.device, 'test', '--no-reinstall-driver', '-e', 'E2E_ISOLATED=true', '--format', 'JUNIT', '--output', str(OUT / f'{step:02}-{name}.xml'), '--debug-output', str(OUT / f'{step:02}-{name}'), str(ROOT / 'native' / (name + '.yaml'))], env=ENV, check=True)

def wait_for(check, description, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value: return value
        time.sleep(0.25)  # Poll a concrete native state; never blindly retry a flow.
    raise AssertionError('Timed out: ' + description)

def geo(longitude):
    adb('emu', 'geo', 'fix', str(longitude), '10.1')

def launch():
    # ADB transport reconnection drops reverse tunnels; restore before every cold launch.
    adb('reverse', 'tcp:8088', 'tcp:8088')
    adb('shell', 'am', 'start', '-n', APP + '/.MainActivity', '-a', 'android.intent.action.VIEW', '-d', 'exp+todaysrun://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8088')

def install_reader():
    adb('push', str(ROOT / 'results/tools/dex/classes.dex'), '/data/local/tmp/todaysrun-snapshot.dex')
    adb('shell', 'run-as', APP, 'mkdir', '-p', 'files/maestro')
    adb('shell', 'run-as', APP, 'cp', '/data/local/tmp/todaysrun-snapshot.dex', 'files/maestro/snapshot.dex')
    adb('shell', 'run-as', APP, 'chmod', '400', 'files/maestro/snapshot.dex')

def snapshot(label=None):
    rows = json.loads(adb('shell', 'run-as', APP, 'env', 'CLASSPATH=files/maestro/snapshot.dex', 'app_process', '/system/bin', 'SqliteSnapshot', '/data/user/0/' + APP + '/files/SQLite/todaysrun.db'))
    records = {}
    for row in rows:
        if row['id'] is None: continue
        record = records.setdefault(row['id'], {key: row[key] for key in ['id','status','active_duration_ms','distance_meters','last_saved_at_ms','ended_at_ms','completion_reason','segment_index','state_revision']})
        record.setdefault('segments', [])
        if row['location_segment'] is not None:
            record['segments'].append({key:row[key] for key in ['location_segment','point_count','first_timestamp','last_timestamp','first_delta']})
    result = {'records': list(records.values()), 'meta': {key:rows[0][key] for key in ['total_runs','total_points','orphan_points','background_enabled','schema_version']}}
    assert result['meta']['orphan_points'] == 0
    assert result['meta']['schema_version'] == 1
    if label: (OUT / (label + '.json')).write_text(json.dumps(result, indent=2))
    return result

def current(state):
    values = [r for r in state['records'] if r['status'] != 'completed']
    assert len(values) == 1, values
    return values[0]

def record(run_id):
    return next(r for r in snapshot()['records'] if r['id'] == run_id)

def stable(run_id, expected, seconds=2.2):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        assert record(run_id) == expected, 'Unexpected time, distance, or path write'
        time.sleep(0.25)

def verify_task(expected):
    # TaskManager's actual persisted registry is available even when Hermes is not attached.
    xml = ET.fromstring(adb('exec-out','run-as',APP,'cat','shared_prefs/TaskManagerModule.xml'))
    names = []
    for entry in xml.findall('string'):
        config = json.loads(entry.text or '{}')
        tasks = config.get('tasks', {})
        if isinstance(tasks, dict): names.extend(tasks)
        else: names.extend(task.get('name',task.get('taskName')) for task in tasks)
    registered = names.count('todaysrun.location.v1')
    lease_xml = ET.fromstring(adb('exec-out','run-as',APP,'cat','shared_prefs/todaysrun.runtime.xml'))
    value = lease_xml.find("string[@name='session']")
    collecting = json.loads(value.text).get('collecting',False) if value is not None else False
    assert registered == (1 if expected else 0), names
    assert collecting == expected

def foreground_service():
    output = adb('shell', 'dumpsys', 'activity', 'services', APP)
    return 'LocationTaskService' in output and 'isForeground=true' in output

def initialize(history=False):
    adb('shell','am','force-stop',APP)
    assert adb('shell','pm','clear',APP) == 'Success'
    for permission in ['ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION','ACCESS_BACKGROUND_LOCATION','POST_NOTIFICATIONS']:
        adb('shell','pm','grant',APP,'android.permission.' + permission)
    adb('shell','settings','put','secure','location_mode','3')
    geo(10.1)
    launch()
    ui('development')
    install_reader()
    ui('start-with-history' if history else 'start')
    wait_for(lambda: snapshot()['meta']['total_points'] > 0, 'first accepted native GPS')
    return snapshot()

def background():
    initial = initialize()
    active = current(initial)
    run_id = active['id']
    pid = adb('shell','pidof',APP)
    assert foreground_service()
    verify_task(True)
    adb('shell','input','keyevent','3')
    adb('shell','cmd','statusbar','expand-notifications')
    ui('notification')
    adb('shell','input','keyevent','4')
    geo(10.1001)
    wait_for(lambda: record(run_id)['distance_meters'] > active['distance_meters'] + 5, 'background GPS distance')
    in_background = record(run_id)
    snapshot('background')
    adb('shell','input','keyevent','26')
    wait_for(lambda: 'mWakefulness=Asleep' in adb('shell','dumpsys','power'), 'screen lock')
    geo(10.1002)
    wait_for(lambda: record(run_id)['distance_meters'] > in_background['distance_meters'] + 5, 'GPS while locked')
    locked = record(run_id)
    snapshot('locked')
    assert locked['active_duration_ms'] > in_background['active_duration_ms']
    assert adb('shell','pidof',APP) == pid
    adb('shell','input','keyevent','224')
    adb('shell','wm','dismiss-keyguard')
    ui('return-running')
    assert current(snapshot())['id'] == run_id
    ui('pause')
    paused = record(run_id)
    assert paused['status'] == 'paused'
    assert not foreground_service()
    verify_task(False)
    geo(10.101)
    stable(run_id, paused)
    ui('resume')
    verify_task(True)
    wait_for(lambda: len(record(run_id)['segments']) > len(paused['segments']), 'new Resume segment')
    resumed = record(run_id)
    assert resumed['segments'][-1]['first_delta'] == 0
    geo(10.1011)
    wait_for(lambda: record(run_id)['distance_meters'] > paused['distance_meters'] + 5, 'resumed GPS distance')
    ui('pause')
    ui('finish')
    finished = record(run_id)
    assert finished['status'] == 'completed' and finished['completion_reason'] == 'normal'
    assert not foreground_service()
    verify_task(False)
    geo(10.1012)
    stable(run_id, finished)
    adb('shell','cmd','statusbar','expand-notifications')
    ui('no-notification')
    adb('shell','input','keyevent','4')
    snapshot('finished')

def recover(delete=False):
    before = initialize(history=True)
    active = current(before)
    if delete: ui('pause')
    run_id = active['id']
    old_pid = adb('shell','pidof',APP)
    adb('shell','am','force-stop',APP)
    wait_for(lambda: subprocess.run([ADB,'-s',args.device,'shell','pidof',APP], capture_output=True,text=True).stdout.strip() == '', 'actual process death',5)
    frozen = record(run_id)
    snapshot('paused-frozen' if delete else 'running-frozen')
    geo(10.1002)
    stable(run_id, frozen)
    launch()
    ui('delete-recovery' if delete else 'save-recovery')
    after = snapshot('paused-deleted' if delete else 'running-recovered')
    assert adb('shell','pidof',APP) != old_pid
    assert after['meta']['background_enabled'] == before['meta']['background_enabled']
    baseline = [r for r in before['records'] if r['status'] == 'completed']
    assert [r for r in after['records'] if r['id'] in {r['id'] for r in baseline}] == baseline
    if delete:
        assert all(r['id'] != run_id for r in after['records'])
        assert after['meta']['total_points'] == sum(s['point_count'] for r in baseline for s in r['segments'])
    else:
        saved = next(r for r in after['records'] if r['id'] == run_id)
        assert saved['status'] == 'completed' and saved['completion_reason'] == 'recovered'
        assert saved['active_duration_ms'] == frozen['active_duration_ms']
        assert saved['distance_meters'] == frozen['distance_meters']
        assert saved['segments'] == frozen['segments']
        assert saved['ended_at_ms'] == frozen['last_saved_at_ms']
    assert not foreground_service()
    verify_task(False)
    adb('shell','am','force-stop',APP)
    launch()
    ui('development')
    assert snapshot() == after

suite = ET.Element('testsuite', name='Android 15 native regression', tests='0', failures='0')
failures = 0
for name in args.cases or ['background','running-recovery','paused-recovery']:
    start = time.monotonic()
    case = ET.SubElement(suite,'testcase',name=name,classname='Android15Native')
    try:
        print('Native case:', name, flush=True)
        {'background':background,'running-recovery':lambda:recover(False),'paused-recovery':lambda:recover(True)}[name]()
        print('PASSED:',name,flush=True)
    except Exception as error:
        failures += 1
        ET.SubElement(case,'failure',message=str(error)).text = repr(error)
        print('FAILED:',name,str(error),flush=True)
        # A failure stops dependent system actions; no unconditional retry.
        break
    finally:
        case.set('time',str(round(time.monotonic()-start,3)))
suite.set('tests',str(len(suite)))
suite.set('failures',str(failures))
ET.ElementTree(suite).write(OUT/'native.xml',encoding='utf-8',xml_declaration=True)
print('Native artifacts:',OUT,flush=True)
raise SystemExit(bool(failures))
