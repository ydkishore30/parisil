#!/usr/bin/env python3
"""Publishes synthetic robot data under /parisil_demo so parisil can be tried without a real robot.

Usage:  source /opt/ros/jazzy/setup.bash && python3 tools/demo_publisher.py
"""
import math
import random

import rclpy
from diagnostic_msgs.msg import DiagnosticArray, DiagnosticStatus, KeyValue
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node
from sensor_msgs.msg import Imu, JointState
from std_msgs.msg import Float64


class DemoPublisher(Node):
    def __init__(self):
        # Everything lives under /parisil_demo so it can never collide with a real robot's topics.
        super().__init__("demo_publisher", namespace="parisil_demo")
        self.declare_parameter("speed", 1.0)
        self.declare_parameter("robot_name", "demo_bot")
        self.imu = self.create_publisher(Imu, "imu/data", 10)
        self.odom = self.create_publisher(Odometry, "odom", 10)
        self.cmd = self.create_publisher(Twist, "cmd_vel", 10)
        self.joints = self.create_publisher(JointState, "joint_states", 10)
        self.battery = self.create_publisher(Float64, "battery/voltage", 10)
        self.diag = self.create_publisher(DiagnosticArray, "diagnostics", 10)
        self.t = 0.0
        self.x = 0.0
        self.y = 0.0
        self.create_timer(0.02, self.fast)
        self.create_timer(1.0, self.slow)

    def fast(self):
        dt = 0.02
        self.t += dt * self.get_parameter("speed").value
        t = self.t
        now = self.get_clock().now().to_msg()

        imu = Imu()
        imu.header.stamp = now
        imu.header.frame_id = "imu_link"
        imu.linear_acceleration.x = math.sin(t * 2.0) + random.gauss(0, 0.05)
        imu.linear_acceleration.y = math.cos(t * 1.3) * 0.5 + random.gauss(0, 0.05)
        imu.linear_acceleration.z = 9.81 + random.gauss(0, 0.1)
        imu.angular_velocity.z = 0.4 * math.sin(t * 0.7)
        self.imu.publish(imu)

        v = 0.5 + 0.3 * math.sin(t * 0.5)
        w = 0.4 * math.sin(t * 0.7)
        yaw = -0.4 / 0.7 * math.cos(t * 0.7)
        self.x += v * math.cos(yaw) * dt
        self.y += v * math.sin(yaw) * dt

        cmd = Twist()
        cmd.linear.x = v
        cmd.angular.z = w
        self.cmd.publish(cmd)

        odom = Odometry()
        odom.header.stamp = now
        odom.header.frame_id = "odom"
        odom.child_frame_id = "base_link"
        odom.pose.pose.position.x = self.x
        odom.pose.pose.position.y = self.y
        odom.pose.pose.orientation.z = math.sin(yaw / 2)
        odom.pose.pose.orientation.w = math.cos(yaw / 2)
        odom.twist.twist.linear.x = v + random.gauss(0, 0.02)
        odom.twist.twist.angular.z = w
        self.odom.publish(odom)

        js = JointState()
        js.header.stamp = now
        js.name = ["left_wheel", "right_wheel", "arm_lift"]
        js.position = [t * 3.0, t * 3.1, 0.3 * math.sin(t)]
        js.velocity = [3.0 + w, 3.0 - w, 0.3 * math.cos(t)]
        js.effort = [random.gauss(1.0, 0.1), random.gauss(1.0, 0.1), 2.0 * math.sin(t)]
        self.joints.publish(js)

    def slow(self):
        voltage = 12.6 - (self.t % 120) * 0.02
        self.battery.publish(Float64(data=voltage))

        arr = DiagnosticArray()
        arr.header.stamp = self.get_clock().now().to_msg()
        batt = DiagnosticStatus(name="power: battery", hardware_id="bms0")
        batt.level = DiagnosticStatus.OK if voltage > 11.4 else DiagnosticStatus.WARN
        batt.message = "nominal" if voltage > 11.4 else "battery low"
        batt.values = [KeyValue(key="voltage", value=f"{voltage:.2f}")]
        motor = DiagnosticStatus(name="drive: left motor", hardware_id="mc_left")
        temp = 45 + 30 * abs(math.sin(self.t * 0.05))
        motor.level = (
            DiagnosticStatus.ERROR if temp > 72 else DiagnosticStatus.WARN if temp > 62 else DiagnosticStatus.OK
        )
        motor.message = "overheating" if temp > 72 else "warm" if temp > 62 else "ok"
        motor.values = [KeyValue(key="temperature", value=f"{temp:.1f}")]
        arr.status = [batt, motor]
        self.diag.publish(arr)

        self.get_logger().info(f"pose x={self.x:.2f} y={self.y:.2f}")
        r = random.random()
        if r < 0.25:
            self.get_logger().warn(f"control loop overrun {random.uniform(1, 5):.1f} ms")
        elif r < 0.32:
            self.get_logger().error("lost contact with motor controller, retrying")
        self.get_logger().debug(f"battery {voltage:.2f} V")


def main():
    rclpy.init()
    node = DemoPublisher()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
