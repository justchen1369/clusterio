import React, { useContext, useState } from "react";
import { useHistory } from "react-router-dom";
import { Button, Form, Input, Modal, PageHeader, Table } from "antd";

import { libConfig, libLink, libErrors } from "@clusterio/lib";

import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import { useInstanceList } from "../model/instance";
import { notifyErrorHandler } from "../util/notify";
import { useSlaveList } from "../model/slave";

function StartAllButton(props) {
	let [instanceList] = useInstanceList();

	let [loading, setLoading] = useState(false);

	let control = useContext(ControlContext);

	return <Button
		onClick={async () => {
			setLoading(true);
			for (const instance of instanceList) {
				if (instance.status === "stopped") {
					try {
						await libLink.messages.startInstance.send(control, { instance_id: instance.id, save: null });
					} catch (err) {
						notifyErrorHandler(`Error starting "${instance.name}"`)(err);
						if (err instanceof libErrors.SessionLost) {
							break;
						}
					}
				}
			}
			setLoading(false);
		}}
		loading={loading}
	>Start All</Button>;
}

function StopAllButton(props) {
	let [instanceList] = useInstanceList();
	let control = useContext(ControlContext);

	let [loading, setLoading] = useState(false);

	return <Button
		onClick={async () => {
			setLoading(true);
			for (const instance of instanceList) {
				if (instance.status === "running") {
					try {
						await libLink.messages.stopInstance.send(control, { instance_id: instance.id });
					} catch (err) {
						notifyErrorHandler(`Error stopping "${instance.name}"`)(err);
						if (err instanceof libErrors.SessionLost) {
							break;
						}
					}
				}
			}
			setLoading(false);
		}}
		loading={loading}
	>Stop All</Button>;
}

function CreateInstanceButton(props) {
	let control = useContext(ControlContext);
	let history = useHistory();
	let [visible, setVisible] = useState(false);
	let [form] = Form.useForm();

	async function createInstance() {
		let values = form.getFieldsValue();
		if (!values.instanceName) {
			form.setFields([{ name: "instanceName", errors: ["Name is required"] }]);
			return;
		}

		let instanceConfig = new libConfig.InstanceConfig("control");
		await instanceConfig.init();
		instanceConfig.set("instance.name", values.instanceName);
		let serialized_config = instanceConfig.serialize("master");
		let result = await libLink.messages.createInstance.send(control, { serialized_config });
		setVisible(false);
		history.push(`/instances/${instanceConfig.get("instance.id")}/view`);
	}

	return <>
		<Button
			type="primary"
			onClick={() => {
				setVisible(true);
			}}
		>Create New</Button>
		<Modal
			title="Create Instance"
			okText="Create"
			visible={visible}
			onOk={() => { createInstance().catch(notifyErrorHandler("Error creating instance")); }}
			onCancel={() => { setVisible(false); }}
			destroyOnClose
		>
			<Form form={form}>
				<Form.Item name="instanceName" label="Name">
					<Input />
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

function CreateHeaderButtons() {
	return <>
		<StartAllButton />
		<StopAllButton />
		<CreateInstanceButton />
	</>;
}
export default function InstancesPage() {
	let history = useHistory();
	let [slaveList] = useSlaveList();
	let [instanceList] = useInstanceList();

	return <PageLayout nav={[{ name: "Instances" }]}>
		<PageHeader
			className="site-page-header"
			title="Instances"
			extra=<CreateHeaderButtons />
		/>

		<Table
			columns={[
				{
					title: "Name",
					dataIndex: "name",
				},
				{
					title: "Assigned Slave",
					key: "assigned_slave",
					render: instance => {
						let slave = slaveList.find(s => s.id === instance.assigned_slave);
						if (slave) {
							return slave.name;
						}
						return instance.assigned_slave;
					},
				},
				{
					title: "Status",
					dataIndex: "status",
				},
			]}
			dataSource={instanceList}
			rowKey={instance => instance["id"]}
			pagination={false}
			onRow={(record, rowIndex) => ({
				onClick: event => {
					history.push(`/instances/${record.id}/view`);
				},
			})}
		/>
	</PageLayout>;
}
