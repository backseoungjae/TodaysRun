#!/usr/bin/env python3
"""Run independent flows only on the disposable TodaysRunMaestroApi35 AVD."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
AVD = 'TodaysRunMaestroApi35'
APP = 'com.todaysrun.app'
parser = argparse.ArgumentParser()
parser.add_argument('--device', default='emulator-5560')
parser.add_argument('flows', nargs='*', help='Flow names, for example a-navigation')
args = parser.parse_args()
sdk = Path(os.environ.get('ANDROID_HOME', Path.home() / 'Library/Android/sdk'))
adb = str(sdk / 'platform-tools/adb')
maestro = str(Path.home() / '.maestro/bin/maestro')
env = dict(os.environ, JAVA_HOME=os.environ.get('JAVA_HOME', '/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home'))
env['PATH'] = str(sdk / 'platform-tools') + os.pathsep + env.get('PATH', '')
def device(*command):
    return subprocess.check_output([adb, '-s', args.device, *command], text=True).strip()
if device('emu', 'avd', 'name').splitlines()[0].strip() != AVD:
    sys.exit('Refusing destructive tests: target must be the disposable ' + AVD + ' AVD.')
if device('shell', 'am', 'get-current-user') != '0':
    sys.exit('Refusing tests in an unexpected Android user.')
if int(device('shell', 'getprop', 'ro.build.version.sdk')) < 31:
    sys.exit('Maestro setLocation requires API 31+.')
selected = [ROOT / 'flows' / (name.removesuffix('.yaml') + '.yaml') for name in args.flows] if args.flows else sorted((ROOT / 'flows').glob('*.yaml'))
results = ROOT / 'results'
results.mkdir(exist_ok=True)
run_dir = results / ("run-" + time.strftime("%Y%m%d-%H%M%S"))
run_dir.mkdir(exist_ok=False)
failures = []
report = ET.Element("testsuites")
for flow in selected:
    if not flow.is_file(): sys.exit('Missing flow: ' + str(flow))
    # The device identity is checked above; this never targets the user's original AVD.
    device('shell', 'am', 'force-stop', APP)
    if device('shell', 'pm', 'clear', APP) != 'Success': sys.exit('Test reset failed.')
    print('\nRunning isolated flow:', flow.stem, flush=True)
    result = subprocess.run([maestro, '--device', args.device, 'test', '--no-reinstall-driver', '-e', 'E2E_ISOLATED=true', '--format', 'JUNIT', '--output', str(run_dir / (flow.stem + '.xml')), '--debug-output', str(run_dir / flow.stem), str(flow)], env=env)
    if result.returncode: failures.append(flow.stem)
    xml = run_dir / (flow.stem + '.xml')
    if xml.exists():
        for suite in ET.parse(xml).getroot(): report.append(suite)
    else:
        suite = ET.SubElement(report, 'testsuite', name=flow.stem, tests='1', failures='1')
        case = ET.SubElement(suite, 'testcase', name=flow.stem)
        ET.SubElement(case, 'failure', message='Maestro did not generate JUnit; see CLI debug output.')
ET.ElementTree(report).write(run_dir / 'junit.xml', encoding='utf-8', xml_declaration=True)
print('JUnit:', run_dir / 'junit.xml')
print('Failed flows:', ', '.join(failures) or 'none')
sys.exit(bool(failures))
